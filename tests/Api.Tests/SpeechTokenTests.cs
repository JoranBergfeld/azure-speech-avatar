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
