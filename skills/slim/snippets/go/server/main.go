// Copyright AGNTCY Contributors (https://github.com/agntcy)
// SPDX-License-Identifier: Apache-2.0

// Minimal A2A echo agent served over SLIM (slim-a2a-go v0.5.x, A2A v1.0).
//
// Run:  SLIM_SHARED_SECRET=<32+ chars> go run ./server
// Needs a SLIM node on http://localhost:46357 (override with SLIM_URL) and
// the native library installed once (from this module directory) with:
//
//	go run github.com/agntcy/slim-bindings-go/v3/cmd/slim-bindings-setup
package main

import (
	"context"
	"fmt"
	"iter"
	"log"
	"os"
	"strings"

	"github.com/a2aproject/a2a-go/v2/a2a"
	"github.com/a2aproject/a2a-go/v2/a2asrv"
	a2aslimrpc "github.com/agntcy/slim-a2a-go/a2aslimrpc/v1"
	slim_bindings "github.com/agntcy/slim-bindings-go/v3"
	slim_rpc "github.com/agntcy/slim-bindings-go/v3/slim_rpc"
)

type echoExecutor struct{}

func (echoExecutor) Execute(ctx context.Context, execCtx *a2asrv.ExecutorContext) iter.Seq2[a2a.Event, error] {
	return func(yield func(a2a.Event, error) bool) {
		// The request handler expects a Task to exist before status/artifact events.
		if execCtx.StoredTask == nil {
			if !yield(a2a.NewSubmittedTask(execCtx, execCtx.Message), nil) {
				return
			}
		}
		var text strings.Builder
		for _, p := range execCtx.Message.Parts {
			if t, ok := p.Content.(a2a.Text); ok {
				text.WriteString(string(t))
			}
		}
		reply := a2a.NewTextPart("echo: " + text.String())
		if !yield(a2a.NewArtifactEvent(execCtx, reply), nil) {
			return
		}
		yield(a2a.NewStatusUpdateEvent(execCtx, a2a.TaskStateCompleted, a2a.NewMessage(a2a.MessageRoleAgent, reply)), nil)
	}
}

func (echoExecutor) Cancel(_ context.Context, execCtx *a2asrv.ExecutorContext) iter.Seq2[a2a.Event, error] {
	return func(yield func(a2a.Event, error) bool) {
		yield(a2a.NewStatusUpdateEvent(execCtx, a2a.TaskStateCanceled, nil), nil)
	}
}

func run() error {
	slimURL := os.Getenv("SLIM_URL")
	if slimURL == "" {
		slimURL = "http://localhost:46357"
	}

	slim_bindings.InitializeWithDefaults()
	svc := slim_bindings.GetGlobalService()

	// Registers on SLIM as agntcy/demo/echo_agent.
	name := slim_bindings.NewName("agntcy", "demo", "echo_agent")
	app, err := svc.CreateAppWithSecret(name, os.Getenv("SLIM_SHARED_SECRET"))
	if err != nil {
		return fmt.Errorf("create app: %w", err)
	}
	defer app.Destroy()
	connID, err := svc.Connect(slim_bindings.NewInsecureClientConfig(slimURL))
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	if err := app.Subscribe(name, &connID); err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}

	server := slim_rpc.ServerNewWithConnection(app, name, &connID)
	a2aslimrpc.NewHandler(a2asrv.NewHandler(echoExecutor{})).RegisterWith(server)
	log.Println("echo agent serving as agntcy/demo/echo_agent")
	return server.ServeBlocking()
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}
