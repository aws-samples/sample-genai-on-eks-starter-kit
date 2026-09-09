# Keycloak — OIDC identity provider

Deploys Keycloak 26.3 as a single-replica StatefulSet in the `keycloak`
namespace and imports a `genai` realm containing the confidential
`traffic-dashboard` client used by `components/gui-app/traffic-dashboard`.

Exposed on the shared internet-facing ALB at `keycloak.{DOMAIN}`; external-dns
creates the Route53 record from the Ingress host.

## Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `DOMAIN` | yes | Host becomes `keycloak.{DOMAIN}` |
| `KEYCLOAK_ADMIN` | yes | Bootstrap admin, also created as a realm user |
| `KEYCLOAK_ADMIN_PASSWORD` | yes | |
| `KEYCLOAK_DASHBOARD_CLIENT_SECRET` | generated | Written to `.env.local` on first install so re-installs and the dashboard component reuse it |

## Storage

`KC_DB=dev-file` — the embedded H2 database on an 8Gi PVC. That is deliberate
for this demo platform: it removes the need to provision an RDBMS, at the cost
of no horizontal scaling. Set `KC_DB=postgres` and supply connection details for
anything resembling production.

The realm import runs with `--import-realm`, which skips realms that already
exist. Re-running `install()` therefore preserves users and clients created
through the console; it does not re-apply drifted realm settings.

## Verification

```bash
kubectl get pods -n keycloak
kubectl logs -n keycloak statefulset/keycloak | grep -i "imported\|realm"
curl -s https://keycloak.$DOMAIN/realms/genai/.well-known/openid-configuration | head
```

The last command is the discovery document Auth.js fetches; if it returns JSON
with an `issuer` of `https://keycloak.$DOMAIN/realms/genai`, the hostname and
proxy-header configuration are correct.
