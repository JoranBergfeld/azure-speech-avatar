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
