# Azure Speech Avatar Persona-Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a responsive website with an Azure Speech real-time avatar you can hold a hands-free spoken conversation with, grounded in a persona, backed by an ASP.NET Core API that runs a Microsoft Agent Framework (MAF) agent over a Foundry-hosted GPT-4.1 model.

**Architecture:** The browser runs the Azure Speech **JavaScript** SDK: it streams avatar video and microphone audio **peer-to-peer** (WebRTC) directly to Azure Speech, so heavy media never touches the backend. The ASP.NET Core backend is a thin, keyless (Managed Identity) API exposing exactly two endpoints — `GET /api/speech/token` (mints a short-lived Entra token for the Speech SDK) and `POST /api/chat` (runs the MAF `ChatClientAgent`, holding conversation history in an **in-process** `AgentSession` per browser session — no Cosmos/Storage/AI Search). The persona is a repo markdown file loaded at startup as the agent's instructions. A pure-JS state machine governs half-duplex turn-taking (mic auto-pauses while the avatar thinks/speaks) with a sticky mute button.

**Tech Stack:** .NET 10 (`net10.0`) minimal-API ASP.NET Core; `Microsoft.Agents.AI` 1.13.0 + `Microsoft.Agents.AI.OpenAI` 1.13.0 + `Azure.AI.OpenAI` 2.9.0-beta.1 + `Azure.Identity` 1.21.0; xUnit + `Microsoft.AspNetCore.Mvc.Testing`; vanilla ES-module JS frontend with `microsoft-cognitiveservices-speech-sdk` 1.43.0 (CDN); Node built-in `node:test` for JS; Bicep + `azd` (Container Apps) for deploy.

---

## Prerequisites & Verified Tooling

These were confirmed available in the target environment during planning:

| Tool | Version | Used for |
|------|---------|----------|
| `dotnet` | 10.0.301 (SDK) | backend build/test, `net10.0` |
| `node` | v24.14.1 | JS unit tests (`node --test`), syntax check (`node --check`) |
| `az` + `az bicep` | CLI 2.85.0, Bicep 0.42.1 | validate infra (`az bicep build`), RBAC lookups |
| `azd` | 1.25.4 | provision + deploy (Container Apps) |
| Docker | **not present locally** | image build at deploy time — see note |

**Deploy-time note (Docker):** `azd up` builds the container image. If a local Docker engine is unavailable, build & push with `az acr build` and reference the image, or run `azd up` from a machine/agent that has Docker. Local development and all tests in this plan run **without** Docker.

**Verified API facts baked into this plan (do not "correct" them):**
- MAF agent creation is `chatClient.AsAIAgent(instructions:, name:)` returning `AIAgent` (concretely `ChatClientAgent`). The extension method lives in namespace **`OpenAI.Chat`**, so `using OpenAI.Chat;` is required. In-process history: `await agent.CreateSessionAsync()` → `AgentSession`. Turn: `await agent.RunAsync(text, session)` → `AgentResponse` with `.Text` (string). Streaming: `agent.RunStreamingAsync(text, session)` → `IAsyncEnumerable<AgentResponseUpdate>` with `.Text`. (All compile-verified against the pinned package versions on `net10.0`.)
- Speech SDK AAD auth uses `SpeechConfig.fromAuthorizationToken("aad#" + resourceId + "#" + aadToken, region)` for **both** recognizer and avatar synthesizer. The ICE relay endpoint takes the **raw** AAD token: `Authorization: Bearer <token>`.
- Segmentation property id is `SpeechSDK.PropertyId.Speech_SegmentationSilenceTimeoutMs` (added SDK 1.42.0).
- RBAC: `Cognitive Services OpenAI User` = `5e0bd9bd-7b93-4f28-af87-19fc36ad61bd`; `Cognitive Services Speech User` = `f2dc8367-1007-4938-bd23-fe263f013447`.

---

## File Structure

```
azure-speech-avatar.sln
src/Api/Api.csproj                         ASP.NET Core minimal API (assembly + root ns: AvatarApi)
src/Api/Program.cs                         host wiring + endpoint mapping + `public partial class Program`
src/Api/Models/Dtos.cs                     SpeechTokenResponse, ChatRequest, ChatReply records
src/Api/Speech/ISpeechTokenProvider.cs     token provider seam
src/Api/Speech/SpeechTokenProvider.cs      mints AAD token (scope cognitiveservices/.default) + region/resourceId
src/Api/Agents/IAvatarAgent.cs             agent seam used by the chat endpoint
src/Api/Agents/PersonaLoader.cs            loads persona.md, fails clearly if missing
src/Api/Agents/MafAvatarAgent.cs           MAF ChatClientAgent + in-process AgentSession per sessionId
src/Api/wwwroot/index.html                 responsive UI shell (loads Speech SDK from CDN)
src/Api/wwwroot/css/styles.css             responsive styles
src/Api/wwwroot/js/state-machine.js        PURE turn-taking state machine (unit-tested)
src/Api/wwwroot/js/speech.js               Speech SDK glue (STT + avatar WebRTC + token refresh)
src/Api/wwwroot/js/app.js                  wires DOM + state machine + speech
src/Api/appsettings.json                   config keys (endpoints/region/resourceId/persona path)
src/Api/Dockerfile                         multi-stage net10.0 image
persona/persona.md                         persona description + behavioral rules + few-shot Q&A
tests/Api.Tests/Api.Tests.csproj           xUnit + Mvc.Testing
tests/Api.Tests/Fakes.cs                   fake TokenCredential + fake IAvatarAgent
tests/Api.Tests/SpeechTokenTests.cs        provider + endpoint tests
tests/Api.Tests/ChatEndpointTests.cs       chat endpoint tests (success/validation/failure)
tests/Api.Tests/PersonaLoaderTests.cs      persona load + missing-file behavior
tests/Api.Tests/PersonaEvalTests.cs        live persona eval (auto-skips without creds)
tests/js/state-machine.test.mjs            node:test for the state machine
infra/main.bicep                           subscription-scope entry (creates RG, calls resources)
infra/resources.bicep                      all resources + role assignments
infra/main.parameters.json                 azd parameter wiring
azure.yaml                                 azd service definition (Container Apps)
README.md                                  run + deploy instructions (overwrite existing)
scripts/smoke.sh                           curl smoke against a running instance
```

---

## Task 1: Solution skeleton + health endpoint (establish the TDD harness)

**Files:**
- Create: `azure-speech-avatar.sln`, `src/Api/Api.csproj`, `src/Api/Program.cs`
- Create: `tests/Api.Tests/Api.Tests.csproj`, `tests/Api.Tests/HealthTests.cs`

- [ ] **Step 1: Scaffold projects**

Run:
```bash
cd /home/jbergfeld/vcs/azure-speech-avatar
dotnet new sln -n azure-speech-avatar
dotnet new web -f net10.0 -o src/Api -n Api
dotnet new xunit -f net10.0 -o tests/Api.Tests -n Api.Tests
dotnet sln add src/Api/Api.csproj tests/Api.Tests/Api.Tests.csproj
dotnet add tests/Api.Tests/Api.Tests.csproj reference src/Api/Api.csproj
dotnet add tests/Api.Tests/Api.Tests.csproj package Microsoft.AspNetCore.Mvc.Testing
```

- [ ] **Step 2: Replace `src/Api/Program.cs`** with the minimal host + health endpoint and the test-visible `Program` partial:

```csharp
var builder = WebApplication.CreateBuilder(args);

var app = builder.Build();

app.MapGet("/healthz", () => Results.Text("ok"));

app.Run();

public partial class Program { }
```

- [ ] **Step 3: Write the failing test** — `tests/Api.Tests/HealthTests.cs`:

```csharp
using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Api.Tests;

public class HealthTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    public HealthTests(WebApplicationFactory<Program> factory) => _factory = factory;

    [Fact]
    public async Task Healthz_returns_ok()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/healthz");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("ok", await response.Content.ReadAsStringAsync());
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Api.Tests/Api.Tests.csproj`
Expected: PASS (1 test). If `Program` is not accessible, confirm the `public partial class Program { }` line is present.

- [ ] **Step 5: Commit**

```bash
git add azure-speech-avatar.sln src/Api tests/Api.Tests
git commit -m "chore: scaffold API + test harness with health endpoint"
```

---

## Task 2: DTOs

**Files:**
- Create: `src/Api/Models/Dtos.cs`

- [ ] **Step 1: Create the DTOs** — `src/Api/Models/Dtos.cs`:

```csharp
namespace AvatarApi.Models;

/// <summary>Everything the browser needs to authenticate the Speech SDK with Entra.</summary>
public record SpeechTokenResponse(string Token, string Region, string ResourceId);

/// <summary>A single user turn. SessionId is a browser-generated GUID for conversation memory.</summary>
public record ChatRequest(string SessionId, string Text);

/// <summary>The agent's reply text (spoken by the avatar).</summary>
public record ChatReply(string Reply);
```

- [ ] **Step 2: Verify it compiles**

Run: `dotnet build src/Api/Api.csproj`
Expected: Build succeeded.

- [ ] **Step 3: Commit**

```bash
git add src/Api/Models/Dtos.cs
git commit -m "feat: add API DTOs"
```

---

## Task 3: Speech token provider (unit-tested)

**Files:**
- Create: `src/Api/Speech/ISpeechTokenProvider.cs`, `src/Api/Speech/SpeechTokenProvider.cs`
- Create: `tests/Api.Tests/Fakes.cs`, `tests/Api.Tests/SpeechTokenTests.cs`
- Modify: `src/Api/Api.csproj` (add Azure.Identity)

- [ ] **Step 1: Add the Azure.Identity package**

Run: `dotnet add src/Api/Api.csproj package Azure.Identity --version 1.21.0`

- [ ] **Step 2: Create the seam** — `src/Api/Speech/ISpeechTokenProvider.cs`:

```csharp
using AvatarApi.Models;

namespace AvatarApi.Speech;

public interface ISpeechTokenProvider
{
    Task<SpeechTokenResponse> GetAsync(CancellationToken cancellationToken);
}
```

- [ ] **Step 3: Create the implementation** — `src/Api/Speech/SpeechTokenProvider.cs`:

```csharp
using Azure.Core;
using AvatarApi.Models;

namespace AvatarApi.Speech;

public sealed class SpeechTokenProvider : ISpeechTokenProvider
{
    // Scope for Cognitive Services data-plane AAD tokens (Speech STT + avatar).
    private static readonly string[] Scopes = { "https://cognitiveservices.azure.com/.default" };

    private readonly TokenCredential _credential;
    private readonly string _region;
    private readonly string _resourceId;

    public SpeechTokenProvider(TokenCredential credential, IConfiguration configuration)
    {
        _credential = credential;
        _region = configuration["Speech:Region"]
            ?? throw new InvalidOperationException("Speech:Region is not configured.");
        _resourceId = configuration["Speech:ResourceId"]
            ?? throw new InvalidOperationException("Speech:ResourceId is not configured.");
    }

    public async Task<SpeechTokenResponse> GetAsync(CancellationToken cancellationToken)
    {
        AccessToken token = await _credential.GetTokenAsync(
            new TokenRequestContext(Scopes), cancellationToken);
        return new SpeechTokenResponse(token.Token, _region, _resourceId);
    }
}
```

- [ ] **Step 4: Create test doubles** — `tests/Api.Tests/Fakes.cs`:

```csharp
using System.Threading;
using System.Threading.Tasks;
using Azure.Core;
using AvatarApi.Agents;

namespace Api.Tests;

/// <summary>Returns a canned AAD token without any network call.</summary>
public sealed class FakeTokenCredential : TokenCredential
{
    private readonly string _token;
    public FakeTokenCredential(string token = "fake-aad-token") => _token = token;

    public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken)
        => new(_token, System.DateTimeOffset.UtcNow.AddHours(1));

    public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken)
        => new(GetToken(requestContext, cancellationToken));
}

/// <summary>Configurable fake agent: returns a canned reply or throws.</summary>
public sealed class FakeAvatarAgent : IAvatarAgent
{
    private readonly string? _reply;
    private readonly System.Exception? _throw;
    public FakeAvatarAgent(string? reply = "hello from the persona", System.Exception? throwException = null)
    {
        _reply = reply;
        _throw = throwException;
    }

    public Task<string> ReplyAsync(string sessionId, string userText, CancellationToken cancellationToken)
    {
        if (_throw is not null) throw _throw;
        return Task.FromResult(_reply!);
    }
}
```

> Note: `Fakes.cs` references `AvatarApi.Agents.IAvatarAgent`, created in Task 5. If implementing strictly in order, temporarily comment out `FakeAvatarAgent` until Task 5, or implement Task 5's interface file first. The recommended order keeps both in the same commit boundary as their first use.

- [ ] **Step 5: Write the failing provider test** — `tests/Api.Tests/SpeechTokenTests.cs`:

```csharp
using System.Threading;
using System.Threading.Tasks;
using AvatarApi.Speech;
using Microsoft.Extensions.Configuration;
using Xunit;

namespace Api.Tests;

public class SpeechTokenTests
{
    private static IConfiguration Config() => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Speech:Region"] = "swedencentral",
            ["Speech:ResourceId"] = "/subscriptions/s/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/spch",
        })
        .Build();

    [Fact]
    public async Task Provider_returns_token_region_and_resourceId()
    {
        var provider = new SpeechTokenProvider(new FakeTokenCredential("abc123"), Config());

        var result = await provider.GetAsync(CancellationToken.None);

        Assert.Equal("abc123", result.Token);
        Assert.Equal("swedencentral", result.Region);
        Assert.EndsWith("/accounts/spch", result.ResourceId);
    }

    [Fact]
    public void Provider_throws_clear_error_when_region_missing()
    {
        var empty = new ConfigurationBuilder().Build();
        var ex = Assert.Throws<System.InvalidOperationException>(
            () => new SpeechTokenProvider(new FakeTokenCredential(), empty));
        Assert.Contains("Speech:Region", ex.Message);
    }
}
```

- [ ] **Step 6: Run tests to verify they fail then pass**

Run: `dotnet test tests/Api.Tests/Api.Tests.csproj --filter SpeechTokenTests`
Expected: PASS once `SpeechTokenProvider` compiles. (If `FakeAvatarAgent` blocks compilation because Task 5 isn't done, implement Task 5's `IAvatarAgent.cs` file first — it has no dependencies.)

- [ ] **Step 7: Commit**

```bash
git add src/Api/Speech tests/Api.Tests/Fakes.cs tests/Api.Tests/SpeechTokenTests.cs src/Api/Api.csproj
git commit -m "feat: speech token provider (keyless AAD) with unit tests"
```

---

## Task 4: Speech token endpoint

**Files:**
- Modify: `src/Api/Program.cs`
- Create: `tests/Api.Tests/TestFactory.cs`, `tests/Api.Tests/SpeechTokenEndpointTests.cs`

- [ ] **Step 1: Register the provider + credential and map the endpoint** — update `src/Api/Program.cs`:

```csharp
using Azure.Core;
using Azure.Identity;
using AvatarApi.Speech;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<TokenCredential>(_ => new DefaultAzureCredential());
builder.Services.AddSingleton<ISpeechTokenProvider, SpeechTokenProvider>();

var app = builder.Build();

app.MapGet("/healthz", () => Results.Text("ok"));

app.MapGet("/api/speech/token", async (ISpeechTokenProvider provider, CancellationToken ct) =>
{
    try
    {
        return Results.Ok(await provider.GetAsync(ct));
    }
    catch (Exception ex)
    {
        // Explicit-but-graceful: name what failed; never disguise as a normal reply.
        return Results.Problem(title: "speech_token_failed", detail: ex.Message,
            statusCode: StatusCodes.Status502BadGateway);
    }
});

app.Run();

public partial class Program { }
```

- [ ] **Step 2: Create a configurable test factory** — `tests/Api.Tests/TestFactory.cs`:

```csharp
using System;
using Azure.Core;
using AvatarApi.Agents;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Api.Tests;

/// <summary>WebApplicationFactory that swaps in fakes and supplies required config.</summary>
public sealed class TestFactory : WebApplicationFactory<Program>
{
    public TokenCredential Credential { get; set; } = new FakeTokenCredential();
    public IAvatarAgent Agent { get; set; } = new FakeAvatarAgent();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Speech:Region"] = "swedencentral",
                ["Speech:ResourceId"] = "/subscriptions/s/resourceGroups/rg/providers/Microsoft.CognitiveServices/accounts/spch",
                ["AzureOpenAI:Endpoint"] = "https://example.openai.azure.com",
                ["AzureOpenAI:Deployment"] = "gpt-4.1",
            });
        });

        builder.ConfigureServices(services =>
        {
            services.RemoveAll<TokenCredential>();
            services.AddSingleton(Credential);
            services.RemoveAll<IAvatarAgent>();
            services.AddSingleton(Agent);
        });
    }
}
```

- [ ] **Step 3: Write the failing endpoint test** — `tests/Api.Tests/SpeechTokenEndpointTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using AvatarApi.Models;
using Xunit;

namespace Api.Tests;

public class SpeechTokenEndpointTests
{
    [Fact]
    public async Task Token_endpoint_returns_shaped_json()
    {
        using var factory = new TestFactory { Credential = new FakeTokenCredential("tok-123") };
        var client = factory.CreateClient();

        var body = await client.GetFromJsonAsync<SpeechTokenResponse>("/api/speech/token");

        Assert.NotNull(body);
        Assert.Equal("tok-123", body!.Token);
        Assert.Equal("swedencentral", body.Region);
    }

    [Fact]
    public async Task Token_endpoint_returns_502_when_credential_fails()
    {
        using var factory = new TestFactory { Credential = new ThrowingCredential() };
        var client = factory.CreateClient();

        var response = await client.GetAsync("/api/speech/token");

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
    }
}
```

Add this throwing credential to `tests/Api.Tests/Fakes.cs`:

```csharp
/// <summary>Simulates a credential/network failure.</summary>
public sealed class ThrowingCredential : Azure.Core.TokenCredential
{
    public override Azure.Core.AccessToken GetToken(Azure.Core.TokenRequestContext c, CancellationToken t)
        => throw new System.InvalidOperationException("no managed identity");
    public override ValueTask<Azure.Core.AccessToken> GetTokenAsync(Azure.Core.TokenRequestContext c, CancellationToken t)
        => throw new System.InvalidOperationException("no managed identity");
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `dotnet test tests/Api.Tests/Api.Tests.csproj --filter SpeechTokenEndpointTests`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/Api/Program.cs tests/Api.Tests/TestFactory.cs tests/Api.Tests/SpeechTokenEndpointTests.cs tests/Api.Tests/Fakes.cs
git commit -m "feat: GET /api/speech/token with success + explicit failure path"
```

---

## Task 5: Agent seam, persona loader, MAF agent

**Files:**
- Create: `src/Api/Agents/IAvatarAgent.cs`, `src/Api/Agents/PersonaLoader.cs`, `src/Api/Agents/MafAvatarAgent.cs`
- Create: `tests/Api.Tests/PersonaLoaderTests.cs`
- Modify: `src/Api/Api.csproj` (MAF + Azure OpenAI packages)

- [ ] **Step 1: Add MAF + Azure OpenAI packages**

Run:
```bash
dotnet add src/Api/Api.csproj package Microsoft.Agents.AI --version 1.13.0
dotnet add src/Api/Api.csproj package Microsoft.Agents.AI.OpenAI --version 1.13.0
dotnet add src/Api/Api.csproj package Azure.AI.OpenAI --version 2.9.0-beta.1
```

- [ ] **Step 2: Create the agent seam** — `src/Api/Agents/IAvatarAgent.cs`:

```csharp
namespace AvatarApi.Agents;

public interface IAvatarAgent
{
    /// <summary>Runs one conversation turn, keyed by an opaque browser session id.</summary>
    Task<string> ReplyAsync(string sessionId, string userText, CancellationToken cancellationToken);
}
```

- [ ] **Step 3: Create the persona loader** — `src/Api/Agents/PersonaLoader.cs`:

```csharp
namespace AvatarApi.Agents;

public static class PersonaLoader
{
    /// <summary>Reads the persona file, failing with a clear, actionable error if absent/empty.</summary>
    public static string Load(string path)
    {
        if (!File.Exists(path))
            throw new FileNotFoundException(
                $"Persona file not found at '{Path.GetFullPath(path)}'. Set Persona:Path or add persona/persona.md.", path);

        var content = File.ReadAllText(path);
        if (string.IsNullOrWhiteSpace(content))
            throw new InvalidOperationException($"Persona file '{path}' is empty.");

        return content;
    }
}
```

- [ ] **Step 4: Create the MAF agent** — `src/Api/Agents/MafAvatarAgent.cs`:

```csharp
using Microsoft.Agents.AI;
using Microsoft.Extensions.Caching.Memory;

namespace AvatarApi.Agents;

/// <summary>
/// Wraps a MAF ChatClientAgent. Conversation history lives in an in-process AgentSession
/// cached per browser session id (sliding 30-minute expiry). No server-side thread storage.
/// </summary>
public sealed class MafAvatarAgent : IAvatarAgent
{
    private static readonly TimeSpan SessionTtl = TimeSpan.FromMinutes(30);

    private readonly AIAgent _agent;
    private readonly IMemoryCache _sessions;

    public MafAvatarAgent(AIAgent agent, IMemoryCache sessions)
    {
        _agent = agent;
        _sessions = sessions;
    }

    public async Task<string> ReplyAsync(string sessionId, string userText, CancellationToken cancellationToken)
    {
        var session = await _sessions.GetOrCreateAsync($"agent-session:{sessionId}", async entry =>
        {
            entry.SlidingExpiration = SessionTtl;
            return await _agent.CreateSessionAsync(cancellationToken);
        }) ?? throw new InvalidOperationException("Failed to create agent session.");

        AgentResponse response = await _agent.RunAsync(userText, session, cancellationToken: cancellationToken);
        return response.Text;
    }
}
```

- [ ] **Step 5: Write the failing persona-loader test** — `tests/Api.Tests/PersonaLoaderTests.cs`:

```csharp
using System.IO;
using AvatarApi.Agents;
using Xunit;

namespace Api.Tests;

public class PersonaLoaderTests
{
    [Fact]
    public void Load_returns_file_contents()
    {
        var path = Path.GetTempFileName();
        File.WriteAllText(path, "You are Ada.");
        try
        {
            Assert.Equal("You are Ada.", PersonaLoader.Load(path));
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void Load_throws_clear_error_when_missing()
    {
        var missing = Path.Combine(Path.GetTempPath(), "does-not-exist-persona.md");
        var ex = Assert.Throws<FileNotFoundException>(() => PersonaLoader.Load(missing));
        Assert.Contains("Persona file not found", ex.Message);
    }
}
```

- [ ] **Step 6: Run tests to verify pass**

Run: `dotnet test tests/Api.Tests/Api.Tests.csproj --filter PersonaLoaderTests`
Expected: PASS (2 tests). Also confirm the whole solution still builds: `dotnet build`.

- [ ] **Step 7: Commit**

```bash
git add src/Api/Agents tests/Api.Tests/PersonaLoaderTests.cs src/Api/Api.csproj
git commit -m "feat: MAF ChatClientAgent (in-process session) + persona loader"
```

---

## Task 6: Chat endpoint + agent/persona wiring

**Files:**
- Modify: `src/Api/Program.cs`
- Create: `tests/Api.Tests/ChatEndpointTests.cs`

- [ ] **Step 1: Wire the agent + memory cache and map `/api/chat`** — update `src/Api/Program.cs` to add the registrations and endpoint. The full file becomes:

```csharp
using Azure.AI.OpenAI;
using Azure.Core;
using Azure.Identity;
using AvatarApi.Agents;
using AvatarApi.Models;
using AvatarApi.Speech;
using Microsoft.Agents.AI;
using OpenAI.Chat;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddMemoryCache();
builder.Services.AddSingleton<TokenCredential>(_ => new DefaultAzureCredential());
builder.Services.AddSingleton<ISpeechTokenProvider, SpeechTokenProvider>();

// Build the MAF agent once at first use: Azure OpenAI chat client -> AIAgent with persona instructions.
builder.Services.AddSingleton<AIAgent>(sp =>
{
    var cfg = sp.GetRequiredService<IConfiguration>();
    var endpoint = new Uri(cfg["AzureOpenAI:Endpoint"]
        ?? throw new InvalidOperationException("AzureOpenAI:Endpoint is not configured."));
    var deployment = cfg["AzureOpenAI:Deployment"] ?? "gpt-4.1";
    var personaPath = cfg["Persona:Path"] ?? "persona/persona.md";
    var persona = PersonaLoader.Load(personaPath);
    var credential = sp.GetRequiredService<TokenCredential>();

    ChatClient chat = new AzureOpenAIClient(endpoint, credential).GetChatClient(deployment);
    return chat.AsAIAgent(instructions: persona, name: "AvatarAgent");
});
builder.Services.AddSingleton<IAvatarAgent, MafAvatarAgent>();

var app = builder.Build();

app.MapGet("/healthz", () => Results.Text("ok"));

app.MapGet("/api/speech/token", async (ISpeechTokenProvider provider, CancellationToken ct) =>
{
    try
    {
        return Results.Ok(await provider.GetAsync(ct));
    }
    catch (Exception ex)
    {
        return Results.Problem(title: "speech_token_failed", detail: ex.Message,
            statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapPost("/api/chat", async (ChatRequest request, IAvatarAgent agent, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(request.SessionId))
        return Results.BadRequest(new { error = "missing_session" });
    if (string.IsNullOrWhiteSpace(request.Text))
        return Results.BadRequest(new { error = "empty_text" });

    try
    {
        var reply = await agent.ReplyAsync(request.SessionId, request.Text, ct);
        return Results.Ok(new ChatReply(reply));
    }
    catch (Exception ex)
    {
        // Explicit-but-graceful: the frontend shows a named error banner, not a fake reply.
        return Results.Problem(title: "agent_failed", detail: ex.Message,
            statusCode: StatusCodes.Status502BadGateway);
    }
});

app.Run();

public partial class Program { }
```

- [ ] **Step 2: Write the failing chat tests** — `tests/Api.Tests/ChatEndpointTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using AvatarApi.Models;
using Xunit;

namespace Api.Tests;

public class ChatEndpointTests
{
    [Fact]
    public async Task Chat_returns_reply_on_success()
    {
        using var factory = new TestFactory { Agent = new FakeAvatarAgent("I am the persona.") };
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/chat", new ChatRequest("sess-1", "hi"));
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<ChatReply>();

        Assert.Equal("I am the persona.", body!.Reply);
    }

    [Fact]
    public async Task Chat_rejects_empty_text()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/chat", new ChatRequest("sess-1", "   "));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Chat_returns_502_when_agent_throws()
    {
        using var factory = new TestFactory
        {
            Agent = new FakeAvatarAgent(throwException: new System.Exception("model down"))
        };
        var client = factory.CreateClient();

        var response = await client.PostAsJsonAsync("/api/chat", new ChatRequest("sess-1", "hi"));

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
    }
}
```

- [ ] **Step 3: Run tests to verify pass**

Run: `dotnet test tests/Api.Tests/Api.Tests.csproj --filter ChatEndpointTests`
Expected: PASS (3 tests). Full suite: `dotnet test` should be green.

- [ ] **Step 4: Commit**

```bash
git add src/Api/Program.cs tests/Api.Tests/ChatEndpointTests.cs
git commit -m "feat: POST /api/chat with validation + explicit failure path"
```

---

## Task 7: Persona content + config + csproj packaging

**Files:**
- Create: `persona/persona.md`
- Create/Modify: `src/Api/appsettings.json`, `src/Api/Api.csproj`

- [ ] **Step 1: Create the persona** — `persona/persona.md` (edit the content to taste; this is a working default):

```markdown
# Persona: "Ada", the Contoso Museum Guide

You are **Ada**, a warm, concise museum guide for the Contoso Science Museum.
You speak out loud through an avatar, so keep answers SHORT and conversational —
usually one to three sentences. Never use bullet lists, markdown, code, or emoji;
they cannot be spoken naturally.

## What you know
- The museum's opening hours: 9am–5pm, Tuesday to Sunday (closed Mondays).
- The three current exhibits: "Deep Sea", "The Cosmos", and "Tiny Machines".
- Tickets are free for children under 12; adults are 15 euro.

## How you answer
- Be friendly and brief. Prefer plain spoken language.
- If asked something the material above does NOT cover, say clearly that you don't
  know and offer what you can help with instead. Do NOT invent facts.
- If asked to do something outside being a museum guide, politely decline and
  steer back to the museum.

## Example exchanges
Q: When are you open?
A: We're open nine to five, Tuesday through Sunday. We're closed on Mondays.

Q: How much is a ticket?
A: Adults are fifteen euro, and it's free for children under twelve.

Q: What's the wifi password?
A: I'm sorry, I don't have that — I can tell you about our exhibits or opening hours, though.

Q: Write me a poem about taxes.
A: That's a bit outside my wheelhouse as a museum guide, but I'd love to tell you about our Cosmos exhibit.
```

- [ ] **Step 2: Add config keys** — `src/Api/appsettings.json`:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*",
  "AzureOpenAI": {
    "Endpoint": "",
    "Deployment": "gpt-4.1"
  },
  "Speech": {
    "Region": "",
    "ResourceId": ""
  },
  "Persona": {
    "Path": "persona/persona.md"
  }
}
```

- [ ] **Step 3: Package the persona into the app output** — add to `src/Api/Api.csproj` inside a new `<ItemGroup>`:

```xml
  <ItemGroup>
    <Content Include="..\..\persona\persona.md" Link="persona\persona.md">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </Content>
  </ItemGroup>
```

- [ ] **Step 4: Verify build copies the persona**

Run:
```bash
dotnet build src/Api/Api.csproj
test -f src/Api/bin/Debug/net10.0/persona/persona.md && echo "PERSONA COPIED"
```
Expected: `PERSONA COPIED`.

- [ ] **Step 5: Commit**

```bash
git add persona/persona.md src/Api/appsettings.json src/Api/Api.csproj
git commit -m "feat: default persona + config + output packaging"
```

---

## Task 8: Turn-taking state machine (pure JS, unit-tested)

**Files:**
- Create: `src/Api/wwwroot/js/state-machine.js`
- Create: `tests/js/state-machine.test.mjs`

- [ ] **Step 1: Write the failing test** — `tests/js/state-machine.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMachine, States, Events } from '../../src/Api/wwwroot/js/state-machine.js';

test('start connects, connected begins listening', () => {
  const m = createMachine();
  m.dispatch(Events.Start);
  assert.equal(m.state.name, States.Connecting);
  m.dispatch(Events.Connected);
  assert.equal(m.state.name, States.Listening);
});

test('recognized -> thinking -> speaking -> back to listening', () => {
  const m = createMachine({ name: States.Listening, muted: false });
  m.dispatch(Events.Recognized);
  assert.equal(m.state.name, States.Thinking);
  m.dispatch(Events.ReplyReady);
  assert.equal(m.state.name, States.Speaking);
  m.dispatch(Events.SynthesisComplete);
  assert.equal(m.state.name, States.Listening);
});

test('reply failure is an explicit error state', () => {
  const m = createMachine({ name: States.Thinking, muted: false });
  m.dispatch(Events.ReplyFailed);
  assert.equal(m.state.name, States.Error);
  m.dispatch(Events.GiveUp);
  assert.equal(m.state.name, States.Idle);
});

test('mute is sticky: finishing speech while muted goes to Muted, not Listening', () => {
  const m = createMachine({ name: States.Speaking, muted: false });
  m.dispatch(Events.MuteOn);
  m.dispatch(Events.SynthesisComplete);
  assert.equal(m.state.name, States.Muted);
  m.dispatch(Events.MuteOff);
  assert.equal(m.state.name, States.Listening);
});

test('connecting failure -> error', () => {
  const m = createMachine({ name: States.Connecting, muted: false });
  m.dispatch(Events.ConnectFailed);
  assert.equal(m.state.name, States.Error);
});

test('idle timeout while listening returns to idle', () => {
  const m = createMachine({ name: States.Listening, muted: false });
  m.dispatch(Events.IdleTimeout);
  assert.equal(m.state.name, States.Idle);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/js/state-machine.test.mjs`
Expected: FAIL — cannot find module `state-machine.js`.

- [ ] **Step 3: Implement** — `src/Api/wwwroot/js/state-machine.js`:

```javascript
export const States = Object.freeze({
  Idle: 'idle',
  Connecting: 'connecting',
  Listening: 'listening',
  Thinking: 'thinking',
  Speaking: 'speaking',
  Muted: 'muted',
  Error: 'error',
});

export const Events = Object.freeze({
  Start: 'start',
  Connected: 'connected',
  ConnectFailed: 'connectFailed',
  Recognized: 'recognized',
  IdleTimeout: 'idleTimeout',
  ReplyReady: 'replyReady',
  ReplyFailed: 'replyFailed',
  SynthesisComplete: 'synthesisComplete',
  MuteOn: 'muteOn',
  MuteOff: 'muteOff',
  RetrySucceeded: 'retrySucceeded',
  GiveUp: 'giveUp',
  Stop: 'stop',
});

/**
 * Pure half-duplex turn-taking machine. State = { name, muted }.
 * `muted` is tracked independently so it can stay sticky across turns.
 */
export function createMachine(initial = { name: States.Idle, muted: false }) {
  let state = { ...initial };
  const listeners = [];

  function set(next) {
    state = next;
    for (const l of listeners) l(state);
  }

  // Where to go when the mic could resume: Listening unless the user muted.
  function resumeTarget(muted) {
    return muted ? States.Muted : States.Listening;
  }

  function dispatch(event) {
    const { name, muted } = state;
    switch (event) {
      case Events.MuteOn:
        set({ name, muted: true });
        break;
      case Events.MuteOff:
        set({ name: name === States.Muted ? States.Listening : name, muted: false });
        break;
      case Events.Start:
        if (name === States.Idle) set({ name: States.Connecting, muted });
        break;
      case Events.Connected:
        if (name === States.Connecting) set({ name: resumeTarget(muted), muted });
        break;
      case Events.ConnectFailed:
        if (name === States.Connecting) set({ name: States.Error, muted });
        break;
      case Events.Recognized:
        if (name === States.Listening) set({ name: States.Thinking, muted });
        break;
      case Events.IdleTimeout:
        if (name === States.Listening) set({ name: States.Idle, muted });
        break;
      case Events.ReplyReady:
        if (name === States.Thinking) set({ name: States.Speaking, muted });
        break;
      case Events.ReplyFailed:
        if (name === States.Thinking) set({ name: States.Error, muted });
        break;
      case Events.SynthesisComplete:
        if (name === States.Speaking) set({ name: resumeTarget(muted), muted });
        break;
      case Events.RetrySucceeded:
        if (name === States.Error) set({ name: resumeTarget(muted), muted });
        break;
      case Events.GiveUp:
        if (name === States.Error) set({ name: States.Idle, muted });
        break;
      case Events.Stop:
        set({ name: States.Idle, muted });
        break;
      default:
        break;
    }
    return state;
  }

  return {
    get state() { return state; },
    dispatch,
    subscribe(fn) {
      listeners.push(fn);
      return () => listeners.splice(listeners.indexOf(fn), 1);
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/js/state-machine.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/Api/wwwroot/js/state-machine.js tests/js/state-machine.test.mjs
git commit -m "feat: pure turn-taking state machine with tests"
```

---

## Task 9: Speech SDK glue (STT + avatar WebRTC + token refresh)

**Files:**
- Create: `src/Api/wwwroot/js/speech.js`

This module has no unit tests (it drives the browser Speech SDK + WebRTC). It is verified for **syntax** with `node --check` and exercised end-to-end by the manual smoke in Task 13. Code is complete — do not stub.

- [ ] **Step 1: Create** — `src/Api/wwwroot/js/speech.js`:

```javascript
// Browser module. Assumes window.SpeechSDK is loaded (CDN script in index.html).
const SpeechSDK = globalThis.SpeechSDK;

const VOICE = 'en-US-AvaMultilingualNeural';
const AVATAR_CHARACTER = 'lisa';
const AVATAR_STYLE = 'casual-sitting';
const SEGMENTATION_SILENCE_MS = '1000';

/** Fetch the short-lived Entra token + region + resourceId from our backend. */
export async function fetchSpeechToken() {
  const res = await fetch('/api/speech/token');
  if (!res.ok) throw new Error(`speech token failed: ${res.status}`);
  return res.json(); // { token, region, resourceId }
}

/** The SDK wants the composite "aad#{resourceId}#{token}" authorization token. */
export function buildAuthToken(resourceId, token) {
  return `aad#${resourceId}#${token}`;
}

/** Ask the Speech relay for TURN/ICE servers (raw AAD token, NOT the aad# composite). */
export async function fetchIceServer(region, token) {
  const res = await fetch(
    `https://${region}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`ICE relay failed: ${res.status}`);
  const data = await res.json(); // { Urls: [...], Username, Password }
  return { urls: data.Urls, username: data.Username, credential: data.Password };
}

/**
 * Continuous speech-to-text. Callbacks: onRecognizing(text), onRecognized(finalText),
 * onError(message). Returns the recognizer (call .startContinuousRecognitionAsync / stop...).
 */
export function createRecognizer(authToken, region, { onRecognizing, onRecognized, onError }) {
  const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(authToken, region);
  speechConfig.speechRecognitionLanguage = 'en-US';
  speechConfig.setProperty(SpeechSDK.PropertyId.Speech_SegmentationSilenceTimeoutMs, SEGMENTATION_SILENCE_MS);

  const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
  const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

  recognizer.recognizing = (_s, e) => onRecognizing?.(e.result.text);
  recognizer.recognized = (_s, e) => {
    if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && e.result.text?.trim()) {
      onRecognized?.(e.result.text.trim());
    }
  };
  recognizer.canceled = (_s, e) => onError?.(`stt canceled: ${e.errorDetails ?? e.reason}`);

  return recognizer;
}

/**
 * Create + start the avatar. Attaches video/audio to the given elements.
 * Event callbacks: onTurnStart(), onSwitchToIdle(), onSessionEnd().
 * Returns { avatarSynthesizer, peerConnection }.
 */
export async function createAvatar(authToken, region, iceServer, videoEl, audioEl, events) {
  const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(authToken, region);
  speechConfig.speechSynthesisVoiceName = VOICE;

  const videoFormat = new SpeechSDK.AvatarVideoFormat();
  const avatarConfig = new SpeechSDK.AvatarConfig(AVATAR_CHARACTER, AVATAR_STYLE, videoFormat);

  const peerConnection = new RTCPeerConnection({ iceServers: [iceServer] });

  peerConnection.ontrack = (event) => {
    if (event.track.kind === 'video') videoEl.srcObject = event.streams[0];
    if (event.track.kind === 'audio') audioEl.srcObject = event.streams[0];
  };

  // The service opens a data channel to signal avatar lifecycle events.
  peerConnection.addEventListener('datachannel', (event) => {
    event.channel.onmessage = (msg) => {
      const text = typeof msg.data === 'string' ? msg.data : '';
      if (text.includes('EVENT_TYPE_TURN_START')) events.onTurnStart?.();
      else if (text.includes('EVENT_TYPE_SWITCH_TO_IDLE')) events.onSwitchToIdle?.();
      else if (text.includes('EVENT_TYPE_SESSION_END')) events.onSessionEnd?.();
    };
  });

  peerConnection.addTransceiver('video', { direction: 'sendrecv' });
  peerConnection.addTransceiver('audio', { direction: 'sendrecv' });

  const avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechConfig, avatarConfig);
  await avatarSynthesizer.startAvatarAsync(peerConnection);

  return { avatarSynthesizer, peerConnection };
}

/** Speak plain text. Resolves when the synthesizer accepts it (idle event signals completion). */
export function speak(avatarSynthesizer, text) {
  return avatarSynthesizer.speakTextAsync(text);
}

/** Force-stop current speech (used on errors / Stop). */
export function stopSpeaking(avatarSynthesizer) {
  return avatarSynthesizer.stopSpeakingAsync();
}

/**
 * Refresh the AAD auth token on live instances. Setting it on speechConfig does NOT
 * propagate to already-created recognizers/synthesizers — set it on the instances.
 */
export function refreshAuthToken(newAuthToken, recognizer, avatarSynthesizer) {
  if (recognizer) recognizer.authorizationToken = newAuthToken;
  if (avatarSynthesizer) avatarSynthesizer.authorizationToken = newAuthToken;
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check src/Api/wwwroot/js/speech.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/Api/wwwroot/js/speech.js
git commit -m "feat: Speech SDK glue (STT + avatar WebRTC + token refresh)"
```

---

## Task 10: App wiring (DOM + state machine + speech)

**Files:**
- Create: `src/Api/wwwroot/js/app.js`

- [ ] **Step 1: Create** — `src/Api/wwwroot/js/app.js`:

```javascript
import { createMachine, States, Events } from './state-machine.js';
import * as Speech from './speech.js';

const REFRESH_INTERVAL_MS = 9 * 60 * 1000; // refresh AAD token before ~1h expiry
const IDLE_TIMEOUT_MS = 60 * 1000;         // return to idle after a quiet minute

const els = {
  video: document.getElementById('avatar-video'),
  audio: document.getElementById('avatar-audio'),
  start: document.getElementById('start-btn'),
  mute: document.getElementById('mute-btn'),
  status: document.getElementById('status-chip'),
  caption: document.getElementById('caption'),
  error: document.getElementById('error-banner'),
};

const sessionId = crypto.randomUUID();
const machine = createMachine();

let recognizer = null;
let avatarSynthesizer = null;
let auth = null;            // { authToken, region, resourceId, rawToken }
let refreshTimer = null;
let idleTimer = null;

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
}
function clearError() {
  els.error.hidden = true;
}

function armIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => machine.dispatch(Events.IdleTimeout), IDLE_TIMEOUT_MS);
}

async function refreshTokens() {
  try {
    const t = await Speech.fetchSpeechToken();
    auth = { authToken: Speech.buildAuthToken(t.resourceId, t.token), region: t.region,
             resourceId: t.resourceId, rawToken: t.token };
    Speech.refreshAuthToken(auth.authToken, recognizer, avatarSynthesizer);
  } catch (e) {
    showError(`Could not refresh the Speech token: ${e.message}`);
  }
}

async function startRecognition() {
  if (!recognizer) return;
  await new Promise((resolve, reject) =>
    recognizer.startContinuousRecognitionAsync(resolve, reject));
}
async function stopRecognition() {
  if (!recognizer) return;
  await new Promise((resolve) => recognizer.stopContinuousRecognitionAsync(resolve, resolve));
}

// React to state changes: drive mic + status UI.
machine.subscribe(async (state) => {
  els.status.textContent = state.name;
  els.status.dataset.state = state.name;
  els.mute.textContent = state.muted ? 'Unmute' : 'Mute';

  if (state.name === States.Listening) {
    clearError();
    await startRecognition();
    armIdleTimer();
  } else {
    clearTimeout(idleTimer);
    await stopRecognition();
  }

  if (state.name === States.Idle) teardown();
});

async function askAgent(userText) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, text: userText }),
  });
  if (!res.ok) throw new Error(`agent error ${res.status}`);
  const body = await res.json();
  return body.reply;
}

async function onFinalUserText(text) {
  els.caption.textContent = text;
  machine.dispatch(Events.Recognized); // -> Thinking (mic auto-pauses)
  try {
    const reply = await askAgent(text);
    machine.dispatch(Events.ReplyReady); // -> Speaking
    els.caption.textContent = reply;
    await Speech.speak(avatarSynthesizer, reply);
  } catch (e) {
    machine.dispatch(Events.ReplyFailed); // -> Error (explicit)
    showError(`Sorry — I hit a problem answering that: ${e.message}`);
    // Recover the conversation loop so the user can try again.
    machine.dispatch(Events.RetrySucceeded);
  }
}

async function connect() {
  machine.dispatch(Events.Start); // -> Connecting
  try {
    await refreshTokens();
    const iceServer = await Speech.fetchIceServer(auth.region, auth.rawToken);

    recognizer = Speech.createRecognizer(auth.authToken, auth.region, {
      onRecognizing: (t) => { els.caption.textContent = t; },
      onRecognized: (t) => onFinalUserText(t),
      onError: (m) => showError(m),
    });

    const created = await Speech.createAvatar(auth.authToken, auth.region, iceServer,
      els.video, els.audio, {
        onTurnStart: () => { /* avatar started speaking */ },
        onSwitchToIdle: () => machine.dispatch(Events.SynthesisComplete),
        onSessionEnd: () => { showError('The avatar session ended. Press Start to reconnect.'); machine.dispatch(Events.Stop); },
      });
    avatarSynthesizer = created.avatarSynthesizer;

    refreshTimer = setInterval(refreshTokens, REFRESH_INTERVAL_MS);

    // Greet, then begin listening.
    machine.dispatch(Events.Connected);
    await Speech.speak(avatarSynthesizer, 'Hello! Press the microphone question any time. How can I help?');
  } catch (e) {
    machine.dispatch(Events.ConnectFailed);
    showError(`Could not start the avatar: ${e.message}`);
  }
}

function teardown() {
  clearInterval(refreshTimer);
  clearTimeout(idleTimer);
  try { recognizer?.close(); } catch { /* ignore */ }
  try { avatarSynthesizer?.close(); } catch { /* ignore */ }
  recognizer = null;
  avatarSynthesizer = null;
}

els.start.addEventListener('click', () => {
  if (machine.state.name === States.Idle) connect();
});

els.mute.addEventListener('click', () => {
  machine.dispatch(machine.state.muted ? Events.MuteOff : Events.MuteOn);
});
```

- [ ] **Step 2: Verify syntax**

Run: `node --check src/Api/wwwroot/js/app.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/Api/wwwroot/js/app.js
git commit -m "feat: app wiring (DOM + state machine + speech)"
```

---

## Task 11: Responsive UI (HTML + CSS) served by the API

**Files:**
- Create: `src/Api/wwwroot/index.html`, `src/Api/wwwroot/css/styles.css`
- Modify: `src/Api/Program.cs` (serve static files + default document)
- Create: `tests/Api.Tests/StaticFilesTests.cs`

- [ ] **Step 1: Enable static files** — in `src/Api/Program.cs`, add these two lines immediately after `var app = builder.Build();`:

```csharp
app.UseDefaultFiles();
app.UseStaticFiles();
```

- [ ] **Step 2: Create** — `src/Api/wwwroot/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Azure Speech Avatar</title>
  <link rel="stylesheet" href="/css/styles.css" />
  <script src="https://cdn.jsdelivr.net/npm/microsoft-cognitiveservices-speech-sdk@1.43.0/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle.js"></script>
</head>
<body>
  <main class="stage">
    <div id="error-banner" class="error-banner" role="alert" hidden></div>

    <div class="avatar-wrap">
      <video id="avatar-video" autoplay playsinline></video>
      <audio id="avatar-audio" autoplay></audio>
      <span id="status-chip" class="status-chip" data-state="idle">idle</span>
    </div>

    <p id="caption" class="caption" aria-live="polite"></p>

    <div class="controls">
      <button id="start-btn" class="btn btn-primary" type="button">Start conversation</button>
      <button id="mute-btn" class="btn" type="button">Mute</button>
    </div>
  </main>

  <script type="module" src="/js/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create** — `src/Api/wwwroot/css/styles.css`:

```css
:root {
  --bg: #0f1226;
  --panel: #1a1f3c;
  --accent: #4f7cff;
  --text: #eef1ff;
  --error: #ff5470;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100dvh;
  background: radial-gradient(1200px 800px at 50% -10%, #23305e, var(--bg));
  color: var(--text);
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  display: grid;
  place-items: center;
}

.stage {
  width: min(100%, 720px);
  padding: clamp(16px, 4vw, 40px);
  display: flex;
  flex-direction: column;
  gap: 20px;
  align-items: center;
}

.avatar-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: var(--panel);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}

#avatar-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.status-chip {
  position: absolute;
  top: 12px;
  left: 12px;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.8rem;
  text-transform: capitalize;
  background: rgba(0, 0, 0, 0.55);
  color: #cfd6ff;
}
.status-chip[data-state="listening"] { background: #1f7a3d; color: #eaffe f; }
.status-chip[data-state="thinking"] { background: #7a5a1f; }
.status-chip[data-state="speaking"] { background: #1f4f7a; }
.status-chip[data-state="muted"] { background: #5a5a5a; }
.status-chip[data-state="error"] { background: #7a1f2f; }

.caption {
  min-height: 1.6em;
  margin: 0;
  text-align: center;
  font-size: clamp(1rem, 2.5vw, 1.25rem);
  opacity: 0.92;
}

.controls {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}

.btn {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
  color: var(--text);
  padding: 12px 22px;
  border-radius: 12px;
  font-size: 1rem;
  cursor: pointer;
  min-width: 120px;
}
.btn:hover { background: rgba(255, 255, 255, 0.16); }
.btn-primary { background: var(--accent); border-color: transparent; }

.error-banner {
  width: 100%;
  background: var(--error);
  color: #fff;
  padding: 12px 16px;
  border-radius: 12px;
  text-align: center;
}
</style>
```

> Fix the stray `#eaffe f` typo to `#eaffef` when pasting (a valid hex). Remove the trailing `</style>` — this is a `.css` file, not inline HTML.

Corrected tail of `styles.css` (use exactly this for the two lines):

```css
.status-chip[data-state="listening"] { background: #1f7a3d; color: #eaffef; }
```

(and the file must end after the `.error-banner` block — no `</style>`).

- [ ] **Step 4: Write the failing static-serve test** — `tests/Api.Tests/StaticFilesTests.cs`:

```csharp
using System.Net;
using Xunit;

namespace Api.Tests;

public class StaticFilesTests
{
    [Fact]
    public async Task Root_serves_index_html()
    {
        using var factory = new TestFactory();
        var client = factory.CreateClient();

        var response = await client.GetAsync("/");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var html = await response.Content.ReadAsStringAsync();
        Assert.Contains("id=\"avatar-video\"", html);
        Assert.Contains("start-btn", html);
    }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `dotnet test tests/Api.Tests/Api.Tests.csproj --filter StaticFilesTests`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/Api/wwwroot/index.html src/Api/wwwroot/css/styles.css src/Api/Program.cs tests/Api.Tests/StaticFilesTests.cs
git commit -m "feat: responsive avatar UI served by the API"
```

---

## Task 12: Live persona eval test (auto-skips without credentials)

**Files:**
- Create: `tests/Api.Tests/PersonaEvalTests.cs`

This satisfies the spec's "persona eval" item. It only runs when `AZURE_OPENAI_ENDPOINT` is set (i.e., against a real deployment with your logged-in identity); otherwise it no-ops so CI stays green offline.

- [ ] **Step 1: Create** — `tests/Api.Tests/PersonaEvalTests.cs`:

```csharp
using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Azure.AI.OpenAI;
using Azure.Identity;
using AvatarApi.Agents;
using Microsoft.Agents.AI;
using Microsoft.Extensions.Caching.Memory;
using OpenAI.Chat;
using Xunit;

namespace Api.Tests;

public class PersonaEvalTests
{
    private static string? Endpoint => Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT");
    private static bool Live => !string.IsNullOrWhiteSpace(Endpoint);

    private static IAvatarAgent BuildLiveAgent()
    {
        var deployment = Environment.GetEnvironmentVariable("AZURE_OPENAI_DEPLOYMENT") ?? "gpt-4.1";
        var personaPath = Path.Combine(AppContext.BaseDirectory, "persona", "persona.md");
        var persona = PersonaLoader.Load(personaPath);
        ChatClient chat = new AzureOpenAIClient(new Uri(Endpoint!), new DefaultAzureCredential())
            .GetChatClient(deployment);
        AIAgent agent = chat.AsAIAgent(instructions: persona, name: "AvatarAgent");
        return new MafAvatarAgent(agent, new MemoryCache(new MemoryCacheOptions()));
    }

    [Fact]
    public async Task Answers_in_persona_for_known_question()
    {
        if (!Live) return; // skipped offline
        var agent = BuildLiveAgent();

        var reply = await agent.ReplyAsync(Guid.NewGuid().ToString(), "When are you open?", CancellationToken.None);

        Assert.False(string.IsNullOrWhiteSpace(reply));
        Assert.Contains("Tuesday", reply, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Declines_gracefully_for_out_of_scope_question()
    {
        if (!Live) return; // skipped offline
        var agent = BuildLiveAgent();

        var reply = await agent.ReplyAsync(Guid.NewGuid().ToString(), "What's the wifi password?", CancellationToken.None);

        Assert.False(string.IsNullOrWhiteSpace(reply));
        Assert.Contains("don't", reply, StringComparison.OrdinalIgnoreCase);
    }
}
```

- [ ] **Step 2: Verify it builds and is green offline**

Run: `dotnet test tests/Api.Tests/Api.Tests.csproj --filter PersonaEvalTests`
Expected: PASS (2 tests; they early-return because no `AZURE_OPENAI_ENDPOINT`).

- [ ] **Step 3 (optional, requires a real deployment + `az login`): run live**

Run:
```bash
AZURE_OPENAI_ENDPOINT="https://<your-account>.openai.azure.com" \
  dotnet test tests/Api.Tests/Api.Tests.csproj --filter PersonaEvalTests
```
Expected: PASS against the live model (persona answers the known question; declines the unknown one).

- [ ] **Step 4: Commit**

```bash
git add tests/Api.Tests/PersonaEvalTests.cs
git commit -m "test: persona eval (live, auto-skips without credentials)"
```

---

## Task 13: Dockerfile + local smoke script

**Files:**
- Create: `src/Api/Dockerfile`, `.dockerignore`, `scripts/smoke.sh`

- [ ] **Step 1: Create** — `src/Api/Dockerfile`:

```dockerfile
# Build
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY src/Api/Api.csproj src/Api/
RUN dotnet restore src/Api/Api.csproj
COPY src/Api/ src/Api/
COPY persona/ persona/
RUN dotnet publish src/Api/Api.csproj -c Release -o /app

# Runtime
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app ./
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Api.dll"]
```

- [ ] **Step 2: Create** — `.dockerignore` (repo root):

```
**/bin
**/obj
.git
.superpowers
tests
docs
```

- [ ] **Step 3: Create** — `scripts/smoke.sh`:

```bash
#!/usr/bin/env bash
# Smoke-test a running instance. Usage: BASE_URL=http://localhost:5000 scripts/smoke.sh
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:5000}"

echo "health:"
curl -fsS "$BASE_URL/healthz"; echo

echo "speech token:"
curl -fsS "$BASE_URL/api/speech/token" | head -c 200; echo

echo "chat:"
curl -fsS -X POST "$BASE_URL/api/chat" \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"smoke-1","text":"When are you open?"}'; echo
```

- [ ] **Step 4: Verify the app publishes (Docker not required locally) and the script parses**

Run:
```bash
dotnet publish src/Api/Api.csproj -c Release -o /tmp/pub && test -f /tmp/pub/Api.dll && echo PUBLISH_OK
bash -n scripts/smoke.sh && echo SMOKE_SYNTAX_OK
chmod +x scripts/smoke.sh
```
Expected: `PUBLISH_OK` and `SMOKE_SYNTAX_OK`.

> The container image itself is built by `azd up`/ACR at deploy time (Task 15). If a local Docker engine is available you may also verify with `docker build -f src/Api/Dockerfile -t avatar .` from the repo root.

- [ ] **Step 5: Commit**

```bash
git add src/Api/Dockerfile .dockerignore scripts/smoke.sh
git commit -m "chore: container image + smoke script"
```

---

## Task 14: Infrastructure (Bicep)

**Files:**
- Create: `infra/main.bicep`, `infra/resources.bicep`, `infra/main.parameters.json`

- [ ] **Step 1: Create** — `infra/resources.bicep`:

```bicep
@description('Azure region for all resources.')
param location string

@description('Resource name prefix / azd environment name.')
param prefix string

@description('Model deployment name (must match AzureOpenAI:Deployment).')
param modelDeployment string = 'gpt-4.1'

@description('Container image reference; azd overrides this at deploy time.')
param containerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

var uniqueSuffix = uniqueString(resourceGroup().id)
var aiName = toLower('${prefix}-aoai-${uniqueSuffix}')
var speechName = toLower('${prefix}-spch-${uniqueSuffix}')
var lawName = toLower('${prefix}-law-${uniqueSuffix}')
var envName = toLower('${prefix}-cae-${uniqueSuffix}')
var appName = toLower('${prefix}-ca-${uniqueSuffix}')

var openAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'   // Cognitive Services OpenAI User
var speechUserRoleId = 'f2dc8367-1007-4938-bd23-fe263f013447'   // Cognitive Services Speech User

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: lawName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource aiAccount 'Microsoft.CognitiveServices/accounts@2025-04-01-preview' = {
  name: aiName
  location: location
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: aiName
    disableLocalAuth: false
    publicNetworkAccess: 'Enabled'
  }
}

resource model 'Microsoft.CognitiveServices/accounts/deployments@2025-04-01-preview' = {
  parent: aiAccount
  name: modelDeployment
  sku: { name: 'GlobalStandard', capacity: 40 }
  properties: {
    model: { format: 'OpenAI', name: 'gpt-4.1', version: '2025-04-14' }
  }
}

resource speech 'Microsoft.CognitiveServices/accounts@2025-04-01-preview' = {
  name: speechName
  location: location
  kind: 'SpeechServices'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: speechName
    disableLocalAuth: false
    publicNetworkAccess: 'Enabled'
  }
}

resource caEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: { type: 'SystemAssigned' }
  tags: { 'azd-service-name': 'web' }
  properties: {
    managedEnvironmentId: caEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
      }
    }
    template: {
      containers: [
        {
          name: 'web'
          image: containerImage
          resources: { cpu: json('0.5'), memory: '1.0Gi' }
          env: [
            { name: 'AzureOpenAI__Endpoint', value: aiAccount.properties.endpoint }
            { name: 'AzureOpenAI__Deployment', value: modelDeployment }
            { name: 'Speech__Region', value: location }
            { name: 'Speech__ResourceId', value: speech.id }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 2 }
    }
  }
}

resource openAiRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(aiAccount.id, app.id, openAiUserRoleId)
  scope: aiAccount
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleId)
  }
}

resource speechRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(speech.id, app.id, speechUserRoleId)
  scope: speech
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', speechUserRoleId)
  }
}

output WEB_URI string = 'https://${app.properties.configuration.ingress.fqdn}'
output AZURE_OPENAI_ENDPOINT string = aiAccount.properties.endpoint
output SPEECH_REGION string = location
output SPEECH_RESOURCE_ID string = speech.id
```

- [ ] **Step 2: Create** — `infra/main.bicep`:

```bicep
targetScope = 'subscription'

@minLength(1)
@description('azd environment name (used as prefix).')
param environmentName string

@minLength(1)
@description('Primary location for all resources.')
param location string

@description('Container image; azd sets this after building.')
param containerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
}

module resources 'resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    location: location
    prefix: environmentName
    containerImage: containerImage
  }
}

output WEB_URI string = resources.outputs.WEB_URI
output AZURE_OPENAI_ENDPOINT string = resources.outputs.AZURE_OPENAI_ENDPOINT
output SPEECH_REGION string = resources.outputs.SPEECH_REGION
output SPEECH_RESOURCE_ID string = resources.outputs.SPEECH_RESOURCE_ID
```

- [ ] **Step 3: Create** — `infra/main.parameters.json`:

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "environmentName": { "value": "${AZURE_ENV_NAME}" },
    "location": { "value": "${AZURE_LOCATION}" },
    "containerImage": { "value": "${SERVICE_WEB_IMAGE_NAME}" }
  }
}
```

- [ ] **Step 4: Validate the Bicep compiles**

Run: `az bicep build -f infra/main.bicep`
Expected: exits 0 (warnings about `listKeys`/preview API are acceptable; **errors are not**). Fix any errors before committing.

- [ ] **Step 5: Commit**

```bash
git add infra/
git commit -m "infra: AIServices + Speech + Container App + roles (keyless)"
```

---

## Task 15: azd wiring + README + full verification

**Files:**
- Create: `azure.yaml`
- Modify: `README.md` (overwrite the placeholder)

- [ ] **Step 1: Create** — `azure.yaml`:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/Azure/azure-dev/main/schemas/v1.0/azure.yaml.json
name: azure-speech-avatar
metadata:
  template: azure-speech-avatar@0.1.0
services:
  web:
    project: src/Api
    language: dotnet
    host: containerapp
    docker:
      path: Dockerfile
      context: ../..
```

- [ ] **Step 2: Overwrite** — `README.md`:

```markdown
# Azure Speech Avatar (persona agent)

A responsive website with an Azure Speech real-time **avatar** you talk to hands-free.
Speech-to-text and the avatar video run in the browser (peer-to-peer WebRTC); a thin,
keyless ASP.NET Core API mints Speech tokens and runs a Microsoft Agent Framework agent
grounded in a persona (`persona/persona.md`).

## Architecture
- **Frontend** (`src/Api/wwwroot`): Speech JS SDK — STT + avatar. Half-duplex turn-taking
  (mic auto-pauses while the avatar thinks/speaks) with a **sticky mute** button.
- **Backend** (`src/Api`): `GET /api/speech/token` (Managed Identity → Entra token) and
  `POST /api/chat` (MAF `ChatClientAgent`, in-process session per browser session).
- **Infra** (`infra/`): AIServices account + `gpt-4.1`, a Speech account, a Container App
  (system-assigned identity), Log Analytics, and two role assignments. No keys, no
  Cosmos/Storage/AI Search.

## Prerequisites
- .NET 10 SDK, Node 18+ (for JS tests), Azure CLI, Azure Developer CLI (`azd`).
- Docker (only for `azd up` container build) or an ACR remote build.

## Run the tests
```bash
dotnet test                         # backend
node --test tests/js/*.test.mjs     # frontend state machine
```

## Run locally (against real Azure resources)
Provision first with `azd provision`, then set the three config values printed as outputs
(or in `.azure/<env>/.env`) and run:
```bash
cd src/Api
AzureOpenAI__Endpoint="https://<acct>.openai.azure.com" \
Speech__Region="swedencentral" \
Speech__ResourceId="/subscriptions/.../accounts/<speech>" \
dotnet run
```
Open the printed URL, press **Start conversation**, and speak. Use **Mute** in noisy rooms.

## Deploy
```bash
azd up
```
Provisions everything and deploys the container. One command.

## How turn-taking works
STT ends your turn after a short trailing silence; the mic auto-pauses while the agent
thinks and the avatar speaks, then resumes — unless you've muted. Failures surface as an
explicit banner (never a fake "please repeat").
```

- [ ] **Step 3: Full verification sweep**

Run:
```bash
dotnet test
node --test tests/js/state-machine.test.mjs
node --check src/Api/wwwroot/js/app.js && node --check src/Api/wwwroot/js/speech.js
az bicep build -f infra/main.bicep
```
Expected: backend tests green; JS tests green; JS syntax OK; Bicep compiles (no errors).

- [ ] **Step 4: Commit**

```bash
git add azure.yaml README.md
git commit -m "chore: azd config + README"
```

---

## Self-Review (completed by the plan author)

**Spec coverage** — every spec section maps to a task:
- Responsive UI + Start + Mute → Task 11 (UI), Task 10 (mute wiring), Task 8 (sticky-mute logic).
- Hands-free STT / half-duplex turn-taking → Task 8 (state machine) + Task 9/10 (mic auto-pause via start/stop around Listening).
- Avatar via Speech JS SDK, P2P media → Task 9.
- `GET /api/speech/token` (keyless) → Tasks 3–4. `POST /api/chat` → Task 6.
- MAF `ChatClientAgent`, in-process session → Task 5. Persona-as-instructions → Tasks 5 & 7.
- Explicit-but-graceful errors → Tasks 4 & 6 (named 502 problems) + Task 10 (error banner, no fake replies).
- Testing strategy: token (Task 3–4), chat mock-agent (Task 6), state machine incl. error transitions (Task 8), persona eval (Task 12), smoke (Task 13).
- Deployment via azd/Bicep, one command → Tasks 14–15. Project layout → matches "File Structure".

**Placeholder scan:** No `TBD`/`TODO`/"handle errors appropriately" left; all code blocks are complete. Two intentional inline corrections are called out explicitly (the `styles.css` hex typo + stray `</style>`), with the corrected lines provided.

**Type/name consistency:** DTOs (`SpeechTokenResponse`/`ChatRequest`/`ChatReply`), seams (`ISpeechTokenProvider.GetAsync`, `IAvatarAgent.ReplyAsync`), and MAF calls (`AsAIAgent`/`CreateSessionAsync`/`RunAsync`/`AgentResponse.Text`) are used identically across tasks. State-machine `States`/`Events` names match between `state-machine.js`, its tests, and `app.js`. Config keys (`AzureOpenAI:Endpoint`/`Deployment`, `Speech:Region`/`ResourceId`, `Persona:Path`) match between `appsettings.json`, `Program.cs`, `SpeechTokenProvider`, `TestFactory`, and the Bicep `env` (`__` form).

**Known ordering caveat (flagged in Task 3):** `tests/Api.Tests/Fakes.cs` references `IAvatarAgent` (Task 5). Implement `src/Api/Agents/IAvatarAgent.cs` before running Task 3's tests, or keep `FakeAvatarAgent` commented until Task 5. Called out at the point of use.
