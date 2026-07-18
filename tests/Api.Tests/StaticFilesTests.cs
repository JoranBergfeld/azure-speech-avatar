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
