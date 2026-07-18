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
