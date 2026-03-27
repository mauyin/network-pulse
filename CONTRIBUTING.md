# Contributing to Network Pulse

Thanks for your interest in contributing to Network Pulse! This guide will help you get set up and familiar with our development workflow.

## Prerequisites

- **Go** 1.23+
- **Node.js** 22+
- **Docker** & Docker Compose
- **[Just](https://github.com/casey/just)** task runner

## Getting Started

1. Fork and clone the repo:

```bash
git clone https://github.com/<your-username>/network-pulse.git
cd network-pulse
```

2. Copy the environment template:

```bash
cp .env.example .env
# Add at least one EVM RPC URL (Alchemy, Infura, etc.)
```

3. Start infrastructure:

```bash
just infra    # PostgreSQL + Redis
```

4. Run services in development mode (separate terminals):

```bash
just dev-poller      # Go poller with hot reload
just dev-api         # TypeScript API with hot reload
just dev-dashboard   # React dashboard with HMR
```

Or run everything at once:

```bash
just demo
```

## Running Tests

```bash
just test-poller     # Go unit tests
just test-api        # TypeScript unit tests
```

## Project Structure

| Service | Directory | Language |
|---------|-----------|----------|
| Chain Poller | `poller/` | Go |
| API Server | `api/` | TypeScript |
| Dashboard | `dashboard/` | React/TypeScript |

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — code restructuring without behavior change
- `perf:` — performance improvement
- `test:` — adding or updating tests
- `docs:` — documentation changes
- `chore:` — tooling, CI, dependencies

Examples:

```
feat: add DVN reputation decay over time
fix: correct anomaly detection cold start threshold
docs: update API endpoint table in README
```

## Pull Request Process

1. Create a feature branch from `main`:

```bash
git checkout -b feat/your-feature-name
```

2. Make your changes and write tests where applicable.

3. Ensure tests pass:

```bash
just test-poller
just test-api
```

4. Push and open a PR against `main`.

5. Describe what your PR does and why. Reference any related issues.

## Code Style

- **Go**: standard `gofmt` formatting, short function names, error wrapping with context
- **TypeScript**: ESM imports (`.js` extensions), Prisma for CRUD, raw SQL for analytics
- **React**: functional components, TanStack Query for data fetching, Tailwind for styling

## Reporting Issues

Open an issue on GitHub with:

- A clear description of the bug or feature request
- Steps to reproduce (for bugs)
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
