// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

// Minimal A2A echo agent served over SLIM (Agntcy.SlimA2A 0.6.x, A2A v1.0).
//
// Run:  SLIM_SHARED_SECRET=<32+ chars> dotnet run
// Needs a SLIM node on http://localhost:46357 (override with SLIM_URL).

using A2A;
using Microsoft.Extensions.Logging.Abstractions;
using SlimA2A;

const string AgentName = "agntcy/demo/echo_agent";

var endpoint = Environment.GetEnvironmentVariable("SLIM_URL") ?? "http://localhost:46357";
var secret = Environment.GetEnvironmentVariable("SLIM_SHARED_SECRET")
    ?? throw new InvalidOperationException("Set SLIM_SHARED_SECRET (at least 32 characters).");

var card = new AgentCard
{
    Name = "Echo Agent",
    Description = "Returns the received text",
    Version = "1.0.0",
    // Over SLIM the interface URL is slim://<the agent's SLIM name>.
    SupportedInterfaces = [new AgentInterface { Url = $"slim://{AgentName}", ProtocolBinding = "SLIMRPC", ProtocolVersion = "1.0" }],
    DefaultInputModes = ["text/plain"],
    DefaultOutputModes = ["text/plain"],
    Capabilities = new AgentCapabilities { Streaming = true },
    Skills = [new AgentSkill { Id = "echo", Name = "echo", Description = "echo", Tags = ["echo"] }],
};

// Ordinary a2a-dotnet request handler: task lifecycle, persistence and streaming.
var a2a = new A2AServer(new EchoHandler(), new InMemoryTaskStore(), new ChannelEventNotifier(), NullLogger<A2AServer>.Instance);

// One connection per node per process; servers and clients share it.
await using var slim = await SlimA2AConnection.ConnectAsync(new SlimA2AConnectionOptions { Endpoint = endpoint });
await using var server = await slim.StartServerAsync(
    new SlimA2AServerOptions
    {
        Identity = AgentName,                 // registers on SLIM as agntcy/demo/echo_agent
        SharedSecret = secret,
        ResolveExtendedAgentCard = (_, _) => Task.FromResult(card),
    },
    a2a);

Console.CancelKeyPress += (_, e) => { e.Cancel = true; _ = server.StopAsync(); };
Console.WriteLine($"echo agent serving as {AgentName}");
await server.Completion;

internal sealed class EchoHandler : IAgentHandler
{
    public async Task ExecuteAsync(RequestContext context, AgentEventQueue eventQueue, CancellationToken cancellationToken)
    {
        var updater = new TaskUpdater(eventQueue, context.TaskId, context.ContextId);
        // Emit the Task (Submitted) first for new conversations, then artifacts and the final status.
        if (!context.IsContinuation)
            await updater.SubmitAsync(cancellationToken: cancellationToken);

        var text = $"echo: {context.UserText}";
        await updater.AddArtifactAsync([Part.FromText(text)], name: "result", cancellationToken: cancellationToken);
        await updater.CompleteAsync(
            new Message { Role = Role.Agent, MessageId = Guid.NewGuid().ToString("N"), Parts = [Part.FromText(text)] },
            cancellationToken: cancellationToken);
    }
}
