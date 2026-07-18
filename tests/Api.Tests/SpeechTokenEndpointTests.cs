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
        var problem = await response.Content.ReadFromJsonAsync<Microsoft.AspNetCore.Mvc.ProblemDetails>();
        Assert.NotNull(problem);
        Assert.Equal("speech_token_failed", problem!.Title);
    }
}
