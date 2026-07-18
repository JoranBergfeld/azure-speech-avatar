# Azure Speech Avatar (persona agent)

A responsive website with an Azure Speech real-time **avatar** you talk to hands-free.
Speech-to-text and the avatar video run in the browser (peer-to-peer WebRTC); a thin,
keyless ASP.NET Core API mints Speech tokens and runs a Microsoft Agent Framework agent
grounded in a persona (`persona/persona.md`).

## Architecture
- **Frontend** (`src/Api/wwwroot`): Speech JS SDK — STT + avatar. Half-duplex turn-taking
  (mic auto-pauses while the avatar thinks/speaks) with a **sticky mute** button.
- **Backend** (`src/Api`): `GET /api/speech/token` (Managed Identity → Entra token) and
  `POST /api/chat` (MAF `ChatClientAgent`, in-process session per browser session).
- **Infra** (`infra/`): AIServices account + `gpt-4.1`, a Speech account, a Container App
  (system-assigned identity), Log Analytics, and two role assignments. No keys, no
  Cosmos/Storage/AI Search.

## Prerequisites
- .NET 10 SDK, Node 18+ (for JS tests), Azure CLI, Azure Developer CLI (`azd`).
- Docker (only for `azd up` container build) or an ACR remote build.

## Run the tests
```bash
dotnet test                         # backend
node --test tests/js/*.test.mjs     # frontend state machine
```

## Run locally (against real Azure resources)
Provision first with `azd provision`, then set the three config values printed as outputs
(or in `.azure/<env>/.env`) and run:
```bash
cd src/Api
AzureOpenAI__Endpoint="https://<acct>.openai.azure.com" \
Speech__Region="swedencentral" \
Speech__ResourceId="/subscriptions/.../accounts/<speech>" \
dotnet run
```
Open the printed URL, press **Start conversation**, and speak. Use **Mute** in noisy rooms.

## Deploy
```bash
azd up
```
Provisions everything and deploys the container. One command.

## How turn-taking works
STT ends your turn after a short trailing silence; the mic auto-pauses while the agent
thinks and the avatar speaks, then resumes — unless you've muted. Failures surface as an
explicit banner (never a fake "please repeat").
