namespace AvatarApi.Agents;

public interface IAvatarAgent
{
    /// <summary>Runs one conversation turn, keyed by an opaque browser session id.</summary>
    Task<string> ReplyAsync(string sessionId, string userText, CancellationToken cancellationToken);
}
