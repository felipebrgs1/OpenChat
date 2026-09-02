import { describe, expect, it } from "bun:test";

import { collectionReadable, documentLevelReadable, documentReadable } from "./acl";

type MiniUser = { id: string; isAdmin: boolean; roleId: string | null };

const ADMIN: MiniUser = { id: "u-admin", isAdmin: true, roleId: null };
const USER_A = { id: "u-a", isAdmin: false, roleId: "r-a" } as MiniUser;
const USER_B = { id: "u-b", isAdmin: false, roleId: "r-b" } as MiniUser;
const NO_ROLE = { id: "u-x", isAdmin: false, roleId: null } as MiniUser;

const COL_OK = { deletedAt: null, visibility: "by_role" as const };
const COL_ALL = { deletedAt: null, visibility: "all" as const };
const COL_DELETED = { deletedAt: new Date(), visibility: "all" as const };

const DOC_PUB = {
  deletedAt: null,
  ownerId: "u-owner",
  status: "published" as const,
  visibility: "all" as const,
};
const DOC_RESTRICTED = {
  deletedAt: null,
  ownerId: "u-owner",
  status: "published" as const,
  visibility: "by_role" as const,
};
const DOC_DRAFT = { ...DOC_RESTRICTED, status: "draft" as const };
const DOC_OBSOLETE = { ...DOC_PUB, status: "obsolete" as const };
const DOC_OBSOLETE_RESTRICTED = { ...DOC_RESTRICTED, status: "obsolete" as const };
const DOC_DELETED = { ...DOC_PUB, deletedAt: new Date() };

describe("acl — collectionReadable", () => {
  it("admin vê tudo", () => {
    expect(collectionReadable(ADMIN, COL_DELETED, [])).toBe(true);
  });

  it("coleção 'all' é visível para qualquer usuário com cargo", () => {
    expect(collectionReadable(USER_A, COL_ALL, [])).toBe(true);
  });

  it("coleção 'by_role' exige cargo vinculado", () => {
    expect(collectionReadable(USER_A, COL_OK, ["r-a"])).toBe(true);
    expect(collectionReadable(USER_A, COL_OK, ["r-b"])).toBe(false);
    expect(collectionReadable(USER_A, COL_OK, [])).toBe(false);
  });

  it("usuário sem cargo não vê coleção restrita", () => {
    expect(collectionReadable(NO_ROLE, COL_ALL, [])).toBe(true);
    expect(collectionReadable(NO_ROLE, COL_OK, ["r-a"])).toBe(false);
  });

  it("coleção deletada é invisível para não-admin", () => {
    expect(collectionReadable(USER_A, COL_DELETED, [])).toBe(false);
  });
});

describe("acl — documentLevelReadable (coleção já autorizada)", () => {
  it("admin e dono passam sempre", () => {
    expect(documentLevelReadable(ADMIN, DOC_DRAFT, [])).toBe(true);
    expect(documentLevelReadable({ ...USER_A, id: "u-owner" }, DOC_DRAFT, [])).toBe(true);
  });

  it("doc 'all' é legível por qualquer cargo", () => {
    expect(documentLevelReadable(USER_A, DOC_PUB, [])).toBe(true);
  });

  it("doc 'by_role' sem vínculo de cargo é NEGADO (default deny)", () => {
    expect(documentLevelReadable(USER_A, DOC_RESTRICTED, [])).toBe(false);
  });

  it("doc 'by_role' com cargo do usuário é permitido", () => {
    expect(documentLevelReadable(USER_A, DOC_RESTRICTED, ["r-a"])).toBe(true);
    expect(documentLevelReadable(USER_B, DOC_RESTRICTED, ["r-a"])).toBe(false);
  });

  it("draft nunca vaza por cargo — só admin e dono", () => {
    expect(documentLevelReadable(USER_A, DOC_DRAFT, ["r-a"])).toBe(false);
  });
});

describe("acl — documentReadable (política completa)", () => {
  it("acesso à coleção NÃO autoriza documento restrito (bug corrigido)", () => {
    // usuário com acesso à coleção, mas doc restrito a outro cargo
    expect(documentReadable(USER_A, DOC_RESTRICTED, COL_ALL, [], ["r-b"])).toBe(false);
    // antes era OR: bastava acesso à coleção para baixar revisão restrita
  });

  it("coleção restrita bloqueia mesmo com doc 'all'", () => {
    expect(documentReadable(USER_A, DOC_PUB, COL_OK, ["r-b"], [])).toBe(false);
  });

  it("coleção E documento ok → permitido", () => {
    expect(documentReadable(USER_A, DOC_RESTRICTED, COL_OK, ["r-a"], ["r-a"])).toBe(true);
    expect(documentReadable(USER_A, DOC_PUB, COL_OK, ["r-a"], [])).toBe(true);
    expect(documentReadable(USER_A, DOC_PUB, COL_ALL, [], [])).toBe(true);
  });

  it("dono lê o próprio doc mesmo sem cargo/coleção", () => {
    expect(documentReadable({ ...NO_ROLE, id: "u-owner" }, DOC_RESTRICTED, COL_OK, [], [])).toBe(
      true,
    );
  });

  it("draft: só admin e dono (mesmo com coleção+cargo ok)", () => {
    expect(documentReadable(USER_A, DOC_DRAFT, COL_OK, ["r-a"], ["r-a"])).toBe(false);
    expect(documentReadable(ADMIN, DOC_DRAFT, COL_OK, [], [])).toBe(true);
    expect(documentReadable({ ...USER_A, id: "u-owner" }, DOC_DRAFT, COL_OK, [], [])).toBe(true);
  });

  it("obsolete segue regras normais de leitura", () => {
    expect(documentReadable(USER_A, DOC_OBSOLETE, COL_ALL, [], [])).toBe(true);
    expect(documentReadable(USER_A, DOC_OBSOLETE_RESTRICTED, COL_ALL, [], [])).toBe(false);
    expect(documentReadable(USER_A, DOC_OBSOLETE_RESTRICTED, COL_ALL, [], ["r-a"])).toBe(true);
  });

  it("doc ou coleção deletados: ninguém além de admin", () => {
    expect(documentReadable(USER_A, DOC_DELETED, COL_ALL, [], [])).toBe(false);
    expect(documentReadable(USER_A, DOC_PUB, COL_DELETED, [], [])).toBe(false);
    expect(documentReadable(ADMIN, DOC_DELETED, COL_DELETED, [], [])).toBe(true);
  });

  it("usuário sem cargo: só admin, dono ou doc 'all' em coleção 'all'", () => {
    expect(documentReadable(NO_ROLE, DOC_PUB, COL_ALL, [], [])).toBe(true);
    expect(documentReadable(NO_ROLE, DOC_RESTRICTED, COL_ALL, [], [])).toBe(false);
  });
});
