using Azure.Core;
using Azure.Identity;
using AvatarApi.Speech;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<TokenCredential>(_ => new DefaultAzureCredential());
builder.Services.AddSingleton<ISpeechTokenProvider, SpeechTokenProvider>();

var app = builder.Build();

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

app.Run();

public partial class Program { }
