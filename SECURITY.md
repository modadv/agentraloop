# Security Policy

## Reporting a Vulnerability

If you find a security issue in AgentraLoop, do not open a public GitHub issue with exploit details.

Report it privately to the maintainers through the repository contact channel or a private security report if GitHub Security Advisories are enabled for this repository.

Include:

- a clear description of the issue
- affected versions or commit ranges if known
- reproduction steps or a proof of concept
- impact assessment

## Response Expectations

The maintainers aim to:

- acknowledge reports within a reasonable time
- confirm whether the issue is reproducible
- coordinate a fix and disclosure timeline when the report is valid

## Scope

This policy covers:

- the Node.js runtime under `src/`
- the Web Studio under `web/`
- the packaged CLI and HTTP server surfaces

Environment-specific provider credentials and third-party service accounts remain the responsibility of the operator running the system.
