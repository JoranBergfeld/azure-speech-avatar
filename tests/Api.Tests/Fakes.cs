using System.Threading;
using System.Threading.Tasks;
using Azure.Core;
using AvatarApi.Agents;

namespace Api.Tests;

/// <summary>Returns a canned AAD token without any network call.</summary>
public sealed class FakeTokenCredential : TokenCredential
{
    private readonly string _token;
    public FakeTokenCredential(string token = "fake-aad-token") => _token = token;

    public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken)
        => new(_token, System.DateTimeOffset.UtcNow.AddHours(1));

    public override ValueTask<AccessToken> GetTokenAsync(TokenRequestContext requestContext, CancellationToken cancellationToken)
        => new(GetToken(requestContext, cancellationToken));
}

/// <summary>Configurable fake agent: returns a canned reply or throws.</summary>
public sealed class FakeAvatarAgent : IAvatarAgent
{
    private readonly string? _reply;
    private readonly System.Exception? _throw;
    public FakeAvatarAgent(string? reply = "hello from the persona", System.Exception? throwException = null)
    {
        _reply = reply;
        _throw = throwException;
    }

    public Task<string> ReplyAsync(string sessionId, string userText, CancellationToken cancellationToken)
    {
        if (_throw is not null) throw _throw;
        return Task.FromResult(_reply!);
    }
}

/// <summary>Simulates a credential/network failure.</summary>
public sealed class ThrowingCredential : Azure.Core.TokenCredential
{
    public override Azure.Core.AccessToken GetToken(Azure.Core.TokenRequestContext c, CancellationToken t)
        => throw new System.InvalidOperationException("no managed identity");
    public override ValueTask<Azure.Core.AccessToken> GetTokenAsync(Azure.Core.TokenRequestContext c, CancellationToken t)
        => throw new System.InvalidOperationException("no managed identity");
}
