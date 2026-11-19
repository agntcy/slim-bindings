// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

// Call the echo agent over SLIM (Agntcy.SlimA2A 0.6.x, A2A v1.0).
//
// Run:  SLIM_SHARED_SECRET=<same as server> dotnet run -- "hello"

using A2A;
using SlimA2A;

var endpoint = Environment.GetEnvironmentVariable("SLIM_URL") ?? "http://localhost:46357";
var secret = Environment.GetEnvironmentVariable("SLIM_SHARED_SECRET")
    ?? throw new InvalidOperationException("Set SLIM_SHARED_SECRET (same value as the server).");
var input = args.Length > 0 ? args[0] : "hello";

await using var slim = await SlimA2AConnection.ConnectAsync(new SlimA2AConnectionOptions { Endpoint = endpoint });
await using var client = slim.CreateClient(new SlimA2AClientOptions
{
    Identity = "agntcy/demo/echo_client",     // the client's own SLIM name, distinct from the server's
    SharedSecret = secret,
    Remote = "agntcy/demo/echo_agent",        // or the slim:// URL from the agent card
    DefaultTimeout = TimeSpan.FromSeconds(30), // without it SLIM's per-call deadline is 10 hours
});

var request = new SendMessageRequest
{
    Message = new Message { Role = Role.User, MessageId = Guid.NewGuid().ToString("N"), Parts = [Part.FromText(input)] },
};

await foreach (var ev in client.SendStreamingMessageAsync(request))
{
    // Depending on the agent you get a message, a task, or artifact updates.
    IEnumerable<Part> parts = ev.PayloadCase switch
    {
        StreamResponseCase.Message => ev.Message!.Parts ?? [],
        StreamResponseCase.Task => ev.Task!.Artifacts?.SelectMany(a => a.Parts ?? []) ?? [],
        StreamResponseCase.ArtifactUpdate => ev.ArtifactUpdate!.Artifact?.Parts ?? [],
        _ => [],
    };
    foreach (var part in parts)
        if (part.Text is { } text)
            Console.WriteLine(text);
}
