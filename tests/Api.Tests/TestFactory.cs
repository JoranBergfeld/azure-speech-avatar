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
