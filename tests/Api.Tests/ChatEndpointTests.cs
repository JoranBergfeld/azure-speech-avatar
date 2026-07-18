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
