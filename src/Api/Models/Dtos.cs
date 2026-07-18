namespace AvatarApi.Models;

/// <summary>Everything the browser needs to authenticate the Speech SDK with Entra.</summary>
public record SpeechTokenResponse(string Token, string Region, string ResourceId);

/// <summary>A single user turn. SessionId is a browser-generated GUID for conversation memory.</summary>
public record ChatRequest(string SessionId, string Text);

/// <summary>The agent's reply text (spoken by the avatar).</summary>
public record ChatReply(string Reply);
