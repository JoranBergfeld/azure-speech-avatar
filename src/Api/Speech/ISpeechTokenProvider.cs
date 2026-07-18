using AvatarApi.Models;

namespace AvatarApi.Speech;

public interface ISpeechTokenProvider
{
    Task<SpeechTokenResponse> GetAsync(CancellationToken cancellationToken);
}
