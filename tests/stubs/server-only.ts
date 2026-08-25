// Substituto do pacote "server-only" nos testes. O pacote real e um marcador
// de bundler: fora do React Server Components ele apenas lanca erro no import.
// Os testes de integracao rodam em Node puro e precisam do MESMO modulo que
// vai para producao (lib/auth/read-audit.ts, por exemplo), sem afrouxar o
// marcador no codigo de aplicacao. Ver o alias em vitest.integration.config.ts.
export {};
