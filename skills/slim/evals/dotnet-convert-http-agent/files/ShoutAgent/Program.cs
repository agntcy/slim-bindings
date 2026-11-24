// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

using A2A;
using A2A.AspNetCore;

var card = new AgentCard
{
    Name = "Shout Agent",
    Description = "Replies with the user's text in upper case",
    Version = "1.0.0",
    SupportedInterfaces = [new AgentInterface { Url = "http://localhost:5080/a2a", ProtocolBinding = "JSONRPC", ProtocolVersion = "1.0" }],
    DefaultInputModes = ["text/plain"],
    DefaultOutputModes = ["text/plain"],
    Capabilities = new AgentCapabilities { Streaming = true },
    Skills = [new AgentSkill { Id = "shout", Name = "shout", Description = "Upper-cases text", Tags = ["text"] }],
};

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddA2AAgent<ShoutHandler>(card);

var app = builder.Build();
app.MapA2A("/a2a");
app.MapWellKnownAgentCard(card);
app.Run("http://localhost:5080");

public sealed class ShoutHandler : IAgentHandler
{
    public async Task ExecuteAsync(RequestContext context, AgentEventQueue eventQueue, CancellationToken cancellationToken)
    {
        var updater = new TaskUpdater(eventQueue, context.TaskId, context.ContextId);
        if (!context.IsContinuation)
            await updater.SubmitAsync(cancellationToken: cancellationToken);

        var text = (context.UserText ?? string.Empty).ToUpperInvariant();
        await updater.AddArtifactAsync([Part.FromText(text)], name: "shout", cancellationToken: cancellationToken);
        await updater.CompleteAsync(
            new Message { Role = Role.Agent, MessageId = Guid.NewGuid().ToString("N"), Parts = [Part.FromText(text)] },
            cancellationToken: cancellationToken);
    }
}
