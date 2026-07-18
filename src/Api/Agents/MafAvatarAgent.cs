using Microsoft.Agents.AI;
using Microsoft.Extensions.Caching.Memory;

namespace AvatarApi.Agents;

/// <summary>
/// Wraps a MAF ChatClientAgent. Conversation history lives in an in-process AgentSession
/// cached per browser session id (sliding 30-minute expiry). No server-side thread storage.
/// </summary>
public sealed class MafAvatarAgent : IAvatarAgent
{
    private static readonly TimeSpan SessionTtl = TimeSpan.FromMinutes(30);

    private readonly AIAgent _agent;
    private readonly IMemoryCache _sessions;

    public MafAvatarAgent(AIAgent agent, IMemoryCache sessions)
    {
        _agent = agent;
        _sessions = sessions;
    }

    public async Task<string> ReplyAsync(string sessionId, string userText, CancellationToken cancellationToken)
    {
        var session = await _sessions.GetOrCreateAsync($"agent-session:{sessionId}", async entry =>
        {
            entry.SlidingExpiration = SessionTtl;
            return await _agent.CreateSessionAsync(cancellationToken);
        }) ?? throw new InvalidOperationException("Failed to create agent session.");

        AgentResponse response = await _agent.RunAsync(userText, session, cancellationToken: cancellationToken);
        return response.Text;
    }
}
