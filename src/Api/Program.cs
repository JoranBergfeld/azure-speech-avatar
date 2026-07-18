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

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/healthz", () => Results.Text("ok"));

app.MapGet("/api/speech/token", async (ISpeechTokenProvider provider, ILogger<Program> logger, CancellationToken ct) =>
{
    try
    {
        return Results.Ok(await provider.GetAsync(ct));
    }
    catch (OperationCanceledException)
    {
        throw; // client disconnect — not a gateway failure
    }
    catch (Exception ex)
    {
        // Explicit-but-graceful: name what failed and log details server-side;
        // do NOT echo raw exception text (may leak credential-probe internals) to the client.
        logger.LogError(ex, "Speech token request failed");
        return Results.Problem(title: "speech_token_failed",
            detail: "Could not mint a Speech token. See server logs for details.",
            statusCode: StatusCodes.Status502BadGateway);
    }
});

app.MapPost("/api/chat", async (ChatRequest request, IAvatarAgent agent, ILogger<Program> logger, CancellationToken ct) =>
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
    catch (OperationCanceledException)
    {
        throw; // client disconnect — not a gateway failure
    }
    catch (Exception ex)
    {
        // Explicit-but-graceful: the frontend shows a named error banner (keyed off status/title);
        // details are logged server-side, not echoed to the client.
        logger.LogError(ex, "Agent chat request failed for session {SessionId}", request.SessionId);
        return Results.Problem(title: "agent_failed",
            detail: "The assistant could not answer. See server logs for details.",
            statusCode: StatusCodes.Status502BadGateway);
    }
});

app.Run();

public partial class Program { }
