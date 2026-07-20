# Benchmarks

## Sitemap com 20 páginas

Medição local realizada em 20/07/2026 com Node.js 20.18.0, Chromium do
Playwright 1.61.1 e páginas HTML sintéticas servidas em `127.0.0.1`.

| Métrica | Resultado |
| --- | ---: |
| Páginas concluídas | 20 |
| Duração total | 11.777 ms |
| Média por página | 589 ms |
| Pico de RSS do Node.js | 174 MiB |
| Pico de heap do Node.js | 75,2 MiB |
| Issues | 0 |
| Quality gate | aprovado |

Execute novamente com:

```bash
npm run benchmark:sitemap
```

O benchmark cobre descoberta, scans sequenciais e consolidação. As páginas são
locais e estáveis, portanto o resultado representa o overhead da engine, não
latência real de rede. O RSS considera o processo Node.js; subprocessos do
Chromium não estão incluídos.
