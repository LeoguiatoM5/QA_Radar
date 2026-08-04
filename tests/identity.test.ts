import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { createDatabase, type Database } from "../src/database.js";
import { runMigrations } from "../src/migrations.js";
import {
  EmailAlreadyRegisteredError,
  InMemoryIdentityStore,
  PostgresIdentityStore,
  isEmailShaped,
  loginFromEmail,
  normalizeEmail,
  sessionId,
  createSessionToken,
  type IdentityStore,
} from "../src/identity.js";

const ACCOUNT = { provider: "github", providerAccountId: "12345", login: "leo", name: "Leo", avatarUrl: "https://exemplo/a.png", verifiedEmail: undefined };
const CADASTRO = { email: "pessoa@exemplo.com", passwordHash: "scrypt$16384$8$1$abc$def", login: "pessoa", name: "Pessoa" };

function contractFor(name: string, create: () => Promise<IdentityStore>, hooks: { setUp?: () => Promise<void>; tearDown?: () => Promise<void> } = {}) {
  describe(`identity store (${name})`, () => {
    if (hooks.setUp) before(hooks.setUp);
    if (hooks.tearDown) after(hooks.tearDown);

    it("cria a conta no cadastro por e-mail e senha", async () => {
      const store = await create();
      const user = await store.createPasswordUser(CADASTRO);
      assert.ok(user.id);
      assert.equal(user.email, "pessoa@exemplo.com");
      assert.equal(user.hasPassword, true);
      assert.equal(user.emailVerified, false, "e-mail recém-cadastrado ainda não foi confirmado");
    });

    it("recusa o segundo cadastro com o mesmo e-mail, ignorando maiúsculas", async () => {
      // Sem isto, "Pessoa@Exemplo.com" viraria uma segunda conta e quem se
      // cadastrou primeiro nunca entenderia por que a senha "não funciona".
      const store = await create();
      await store.createPasswordUser(CADASTRO);
      await assert.rejects(() => store.createPasswordUser({ ...CADASTRO, email: "Pessoa@Exemplo.COM" }), EmailAlreadyRegisteredError);
    });

    it("devolve as credenciais pelo e-mail para a verificação do login", async () => {
      const store = await create();
      const created = await store.createPasswordUser(CADASTRO);
      const credentials = await store.credentialsByEmail("PESSOA@exemplo.com");
      assert.equal(credentials?.user.id, created.id);
      assert.equal(credentials?.passwordHash, CADASTRO.passwordHash);
    });

    it("não devolve credencial de conta sem senha", async () => {
      // Conta criada só pelo GitHub não tem senha; deixar o login por senha
      // "encontrar" essa conta abriria caminho para entrar sem credencial.
      const store = await create();
      await store.userForIdentity({ ...ACCOUNT, verifiedEmail: "so-github@exemplo.com" });
      assert.equal(await store.credentialsByEmail("so-github@exemplo.com"), undefined);
    });

    it("cria o usuário no primeiro login pelo provedor", async () => {
      const store = await create();
      const user = await store.userForIdentity(ACCOUNT);
      assert.ok(user.id);
      assert.equal(user.login, "leo");
      assert.equal(user.hasPassword, false);
    });

    it("reaproveita a mesma conta no segundo login, atualizando o perfil", async () => {
      const store = await create();
      const first = await store.userForIdentity(ACCOUNT);
      const second = await store.userForIdentity({ ...ACCOUNT, login: "leo-novo", name: "Leo Guiato" });
      assert.equal(second.id, first.id, "a mesma conta do provedor tem de dar o mesmo usuário");
      assert.equal(second.login, "leo-novo");
      assert.equal(second.name, "Leo Guiato");
    });

    it("separa contas diferentes do mesmo provedor", async () => {
      const store = await create();
      const one = await store.userForIdentity(ACCOUNT);
      const other = await store.userForIdentity({ ...ACCOUNT, providerAccountId: "99999", login: "outra" });
      assert.notEqual(other.id, one.id);
    });

    it("separa a mesma conta em provedores diferentes", async () => {
      // O par (provedor, conta) é a identidade: o id 12345 do GitHub não é a
      // mesma pessoa que o id 12345 do Google.
      const store = await create();
      const github = await store.userForIdentity(ACCOUNT);
      const google = await store.userForIdentity({ ...ACCOUNT, provider: "google" });
      assert.notEqual(google.id, github.id);
    });

    it("entrar pelo provedor cai na conta já cadastrada com o mesmo e-mail verificado", async () => {
      // O ponto do vínculo: sem ele a pessoa que se cadastrou por senha ganharia
      // uma segunda conta vazia ao entrar pelo GitHub, e perderia o histórico.
      const store = await create();
      const cadastrada = await store.createPasswordUser(CADASTRO);
      const entrou = await store.userForIdentity({ ...ACCOUNT, verifiedEmail: "PESSOA@exemplo.com" });
      assert.equal(entrou.id, cadastrada.id);
      assert.equal(entrou.hasPassword, true, "a senha existente continua valendo");
      assert.equal(entrou.emailVerified, true, "entrar pelo provedor com o mesmo endereço prova a posse dele");
    });

    it("não vincula quando o provedor não garante o e-mail", async () => {
      // `verifiedEmail` indefinido é o caso de quem não concedeu o escopo ou só
      // tem endereço não verificado: aceitar assim deixaria qualquer um declarar
      // o e-mail alheio no provedor e cair na conta de outra pessoa.
      const store = await create();
      const cadastrada = await store.createPasswordUser(CADASTRO);
      const entrou = await store.userForIdentity({ ...ACCOUNT, verifiedEmail: undefined });
      assert.notEqual(entrou.id, cadastrada.id);
    });

    it("mantém o vínculo depois de criado, mesmo sem o e-mail vir de novo", async () => {
      const store = await create();
      const cadastrada = await store.createPasswordUser(CADASTRO);
      await store.userForIdentity({ ...ACCOUNT, verifiedEmail: CADASTRO.email });
      const denovo = await store.userForIdentity({ ...ACCOUNT, verifiedEmail: undefined });
      assert.equal(denovo.id, cadastrada.id);
    });

    it("troca a senha e confirma o e-mail", async () => {
      const store = await create();
      const user = await store.createPasswordUser(CADASTRO);
      await store.setPassword(user.id, "scrypt$16384$8$1$novo$hash");
      await store.markEmailVerified(user.id);
      const credentials = await store.credentialsByEmail(CADASTRO.email);
      assert.equal(credentials?.passwordHash, "scrypt$16384$8$1$novo$hash");
      assert.equal(credentials?.user.emailVerified, true);
    });

    it("resolve a sessão de volta para o usuário", async () => {
      const store = await create();
      const user = await store.createPasswordUser(CADASTRO);
      const session = await store.createSession(user.id, 60_000);
      assert.equal((await store.userForSession(session.token))?.id, user.id);
    });

    it("recusa sessão vencida", async () => {
      const store = await create();
      const user = await store.createPasswordUser(CADASTRO);
      const session = await store.createSession(user.id, 60_000);
      assert.equal(await store.userForSession(session.token, new Date(Date.now() + 61_000)), undefined);
    });

    it("recusa token que não existe, sem lançar", async () => {
      const store = await create();
      assert.equal(await store.userForSession(createSessionToken()), undefined);
    });

    it("encerra a sessão no logout", async () => {
      const store = await create();
      const user = await store.createPasswordUser(CADASTRO);
      const session = await store.createSession(user.id, 60_000);
      await store.destroySession(session.token);
      assert.equal(await store.userForSession(session.token), undefined);
    });

    it("mantém as outras sessões da pessoa ao encerrar uma", async () => {
      // Sair num navegador não pode derrubar a sessão do outro.
      const store = await create();
      const user = await store.createPasswordUser(CADASTRO);
      const laptop = await store.createSession(user.id, 60_000);
      const celular = await store.createSession(user.id, 60_000);
      await store.destroySession(laptop.token);
      assert.equal((await store.userForSession(celular.token))?.id, user.id);
    });

    it("derruba todas as sessões da conta quando a senha é redefinida", async () => {
      // Se a redefinição aconteceu porque alguém entrou na conta, deixar a
      // sessão dele viva tornaria a redefinição inútil.
      const store = await create();
      const user = await store.createPasswordUser(CADASTRO);
      const laptop = await store.createSession(user.id, 60_000);
      const celular = await store.createSession(user.id, 60_000);
      await store.destroySessionsFor(user.id);
      assert.equal(await store.userForSession(laptop.token), undefined);
      assert.equal(await store.userForSession(celular.token), undefined);
    });

    it("não derruba a sessão de outra conta ao redefinir uma senha", async () => {
      const store = await create();
      const alvo = await store.createPasswordUser(CADASTRO);
      const outra = await store.createPasswordUser({ ...CADASTRO, email: "outra@exemplo.com" });
      const sessaoDaOutra = await store.createSession(outra.id, 60_000);
      await store.destroySessionsFor(alvo.id);
      assert.equal((await store.userForSession(sessaoDaOutra.token))?.id, outra.id);
    });

    it("limpa só as sessões vencidas", async () => {
      const store = await create();
      const user = await store.createPasswordUser(CADASTRO);
      const curta = await store.createSession(user.id, 1000);
      const longa = await store.createSession(user.id, 600_000);
      assert.equal(await store.purgeExpiredSessions(new Date(Date.now() + 2000)), 1);
      assert.equal(await store.userForSession(curta.token), undefined);
      assert.ok(await store.userForSession(longa.token));
    });

    it("gasta o token de confirmação uma vez só", async () => {
      // Dois cliques no mesmo link não podem conceder duas vezes.
      const store = await create();
      const user = await store.createPasswordUser(CADASTRO);
      const secret = await store.createUserToken(user.id, "email_verification", 60_000);
      assert.equal((await store.consumeUserToken(secret, "email_verification"))?.id, user.id);
      assert.equal(await store.consumeUserToken(secret, "email_verification"), undefined);
    });

    it("recusa o token fora do propósito para o qual foi emitido", async () => {
      // Sem isto, um link de confirmação de e-mail serviria para redefinir a
      // senha — e ele viaja por um canal bem menos protegido.
      const store = await create();
      const user = await store.createPasswordUser(CADASTRO);
      const secret = await store.createUserToken(user.id, "email_verification", 60_000);
      assert.equal(await store.consumeUserToken(secret, "password_reset"), undefined);
    });

    it("recusa token de e-mail vencido", async () => {
      const store = await create();
      const user = await store.createPasswordUser(CADASTRO);
      const secret = await store.createUserToken(user.id, "password_reset", 1000);
      assert.equal(await store.consumeUserToken(secret, "password_reset", new Date(Date.now() + 2000)), undefined);
    });

    it("recusa token de e-mail inexistente, sem lançar", async () => {
      const store = await create();
      assert.equal(await store.consumeUserToken(createSessionToken(), "password_reset"), undefined);
    });
  });
}

describe("normalização de e-mail e apelido", () => {
  it("compara e-mail sem diferenciar maiúsculas nem espaço em volta", () => {
    assert.equal(normalizeEmail("  Pessoa@Exemplo.COM "), "pessoa@exemplo.com");
  });

  it("aceita endereço comum e recusa o que não pode entrar num cabeçalho de e-mail", () => {
    assert.equal(isEmailShaped("pessoa@exemplo.com"), true);
    assert.equal(isEmailShaped("pessoa+qa@sub.exemplo.com.br"), true);
    assert.equal(isEmailShaped("sem-arroba.com"), false);
    assert.equal(isEmailShaped("dois@@exemplo.com"), false);
    assert.equal(isEmailShaped("com espaco@exemplo.com"), false);
    assert.equal(isEmailShaped("injeta@exemplo.com\r\nbcc: outro@x.com"), false);
    assert.equal(isEmailShaped("@exemplo.com"), false);
    assert.equal(isEmailShaped("pessoa@exemplo"), false);
    assert.equal(isEmailShaped("pessoa@.exemplo.com"), false);
  });

  it("monta o apelido a partir do e-mail, sem caractere estranho", () => {
    assert.equal(loginFromEmail("Leo.Guiato+qa@exemplo.com"), "leo.guiato");
    assert.equal(loginFromEmail("a@exemplo.com"), "usuario", "apelido curto demais vira o padrão");
  });
});

contractFor("memória", async () => new InMemoryIdentityStore());

const TEST_DATABASE_URL = process.env.QA_RADAR_TEST_DATABASE_URL;
if (TEST_DATABASE_URL) {
  let database: Database;
  contractFor(
    "postgres",
    async () => {
      await database.query("delete from sessions");
      await database.query("delete from users");
      return new PostgresIdentityStore(database);
    },
    {
      setUp: async () => {
        database = createDatabase(TEST_DATABASE_URL);
        await runMigrations(database);
      },
      tearDown: async () => {
        await database.close();
      },
    },
  );

  describe("sessões e credenciais no postgres", () => {
    let database: Database;
    before(async () => {
      database = createDatabase(TEST_DATABASE_URL);
      await runMigrations(database);
      await database.query("delete from sessions");
      await database.query("delete from users");
    });
    after(async () => {
      await database.close();
    });

    it("nunca grava o token da sessão em claro", async () => {
      // Um vazamento da tabela não pode virar sessão válida de ninguém.
      const store = new PostgresIdentityStore(database);
      const user = await store.userForIdentity(ACCOUNT);
      const session = await store.createSession(user.id, 60_000);
      const rows = await database.query<{ id: string }>("select id from sessions");
      assert.equal(rows.length, 1);
      assert.notEqual(rows[0]?.id, session.token, "o token do cookie não pode estar na tabela");
      assert.equal(rows[0]?.id, sessionId(session.token));
    });

    it("nunca grava em claro o token de confirmação ou de redefinição", async () => {
      // Mesmo raciocínio das sessões: quem lesse a tabela poderia redefinir a
      // senha de qualquer conta.
      const store = new PostgresIdentityStore(database);
      const user = await store.createPasswordUser({ ...CADASTRO, email: `token-${Date.now()}@exemplo.com` });
      const secret = await store.createUserToken(user.id, "password_reset", 60_000);
      const rows = await database.query<{ id: string }>("select id from user_tokens where user_id = $1", [user.id]);
      assert.equal(rows.length, 1);
      assert.notEqual(rows[0]?.id, secret);
      assert.equal(rows[0]?.id, sessionId(secret));
    });

    it("leva sessões, identidades e tokens junto quando o usuário some", async () => {
      const store = new PostgresIdentityStore(database);
      const user = await store.userForIdentity({ ...ACCOUNT, providerAccountId: "para-apagar" });
      const session = await store.createSession(user.id, 60_000);
      await store.createUserToken(user.id, "email_verification", 60_000);
      await database.query("delete from users where id = $1", [user.id]);
      assert.equal(await store.userForSession(session.token), undefined);
      assert.equal((await database.query("select 1 from user_identities where user_id = $1", [user.id])).length, 0);
      assert.equal((await database.query("select 1 from user_tokens where user_id = $1", [user.id])).length, 0);
    });

    it("guarda a identidade externa fora da tabela de usuários", async () => {
      // A conta deixou de ser "uma conta do GitHub": se a identidade voltasse
      // para `users`, a mesma pessoa entrando pelos dois caminhos viraria duas.
      const store = new PostgresIdentityStore(database);
      const user = await store.userForIdentity({ ...ACCOUNT, providerAccountId: "fora-de-users" });
      const columns = await database.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'users'");
      const names = columns.map((column) => column.column_name);
      assert.ok(!names.includes("provider"), "users não pode voltar a ter coluna de provedor");
      assert.ok(!names.includes("provider_account_id"));
      const rows = await database.query<{ user_id: string }>("select user_id from user_identities where provider_account_id = $1", ["fora-de-users"]);
      assert.equal(rows[0]?.user_id, user.id);
    });
  });
}
