# Kong AI Gateway OSS

Currently, we only deploy Kong and setup the API key but we do not setup the routes and integration with OpenWeb UI.

Notes:

- [AI Proxy plugin](https://developer.konghq.com/plugins/ai-proxy) currently does not provide the simple way to setup mulitple models on the same URL path. See `components/ai-gateway/kong/examples/kong.yaml` as example to set a route for each model.

- Alternatively, check [this example](https://developer.konghq.com/plugins/ai-proxy/examples/sdk-two-routes/) for setting up the AI proxy plugin routing based on matching different URL paths.

- To integrate with Open WebUI, since the `/v1/models` path is not avaaiable, you will need to manually specify them on the `Model IDs` when creating the connection.

- [Kong Manager OSS](https://github.com/Kong/kong-manager) currently does not provide an easy way to implement the authentication without the licensed enterprise RBAC feature. The workaround now is to do the port forward.

```
# Kong Manager
kubectl -n kong port-forward svc/kong-kong-manager 8002:8002

# Kong Admin API (also required since Kong Manager UI will connect directly to it from the browser)
kubectl -n kong port-forward svc/kong-kong-admin 8001:800
```
