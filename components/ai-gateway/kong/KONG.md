# Kong AI Gateway OSS

Currently, we only deploy Kong and setup the API key but we do not setup the routes and integration with OpenWeb UI.

Notes:

- [AI Proxy plugin](https://developer.konghq.com/plugins/ai-proxy) currently does not provide the simple way to setup mulitple models on the same URL path. See `components/ai-gateway/kong/examples/kong.yaml` as example to set a route for each model.

- Alternatively, check [this example](https://developer.konghq.com/plugins/ai-proxy/examples/sdk-two-routes/) for setting up the AI proxy plugin routing based on matching different URL paths.

- To integrate with Open WebUI, since the `/v1/models` path is not avaaiable, you will need to manually specify them on the `Model IDs` when creating the connection.
