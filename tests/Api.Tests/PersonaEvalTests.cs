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
