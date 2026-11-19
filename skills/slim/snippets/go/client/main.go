// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

// Call the echo agent over SLIM (slim-a2a-go v0.5.x, A2A v1.0).
//
// Run:  SLIM_SHARED_SECRET=<same as server> go run ./client "hello"
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/a2aproject/a2a-go/v2/a2a"
	"github.com/a2aproject/a2a-go/v2/a2aclient"
	a2aslimrpc "github.com/agntcy/slim-a2a-go/a2aslimrpc/v1"
	slim_bindings "github.com/agntcy/slim-bindings-go/v3"
)

func run(ctx context.Context, text string) error {
	slimURL := os.Getenv("SLIM_URL")
	if slimURL == "" {
		slimURL = "http://localhost:46357"
	}

	slim_bindings.InitializeWithDefaults()
	svc := slim_bindings.GetGlobalService()

	// The client needs its own SLIM name, distinct from the server's.
	name := slim_bindings.NewName("agntcy", "demo", "echo_client")
	app, err := svc.CreateAppWithSecret(name, os.Getenv("SLIM_SHARED_SECRET"))
	if err != nil {
		return fmt.Errorf("create app: %w", err)
	}
	defer app.Destroy()
	connID, err := svc.Connect(slim_bindings.NewInsecureClientConfig(slimURL))
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	if err := app.Subscribe(name, &connID); err != nil { // receive replies
		return fmt.Errorf("subscribe: %w", err)
	}

	factory := a2aclient.NewFactory(
		a2aclient.WithDefaultsDisabled(), // no HTTP transports
		a2aslimrpc.WithSLIMRPCTransport(app, &connID),
	)
	// Over SLIM the agent is addressed by its SLIM name; no HTTP card fetch.
	card := &a2a.AgentCard{SupportedInterfaces: []*a2a.AgentInterface{
		a2a.NewAgentInterface("agntcy/demo/echo_agent", a2aslimrpc.SLIMProtocol),
	}}
	client, err := factory.CreateFromCard(ctx, card)
	if err != nil {
		return fmt.Errorf("create client: %w", err)
	}
	defer client.Destroy()

	msg := a2a.NewMessage(a2a.MessageRoleUser, a2a.NewTextPart(text))
	result, err := client.SendMessage(ctx, &a2a.SendMessageRequest{Message: msg})
	if err != nil {
		return fmt.Errorf("send message: %w", err)
	}

	// Depending on the agent you get a *a2a.Message or a *a2a.Task.
	var parts a2a.ContentParts
	switch r := result.(type) {
	case *a2a.Message:
		parts = r.Parts
	case *a2a.Task:
		for _, art := range r.Artifacts {
			parts = append(parts, art.Parts...)
		}
	}
	for _, p := range parts {
		if t, ok := p.Content.(a2a.Text); ok {
			fmt.Println(string(t))
		}
	}
	return nil
}

func main() {
	text := "hello"
	if len(os.Args) > 1 {
		text = os.Args[1]
	}
	if err := run(context.Background(), text); err != nil {
		log.Fatal(err)
	}
}
