# Extra root certificates

On a network that inspects HTTPS traffic (a corporate proxy), `npm ci` inside
the Docker build fails with `self-signed certificate in certificate chain`.
Put the corporate root CA here as a PEM file (`.crt` or `.pem`) and rebuild:

```bash
docker compose build
```

Every `.crt`/`.pem` in this folder is trusted during the build. Leave the folder
empty off the corporate network. Certificate files are gitignored.
