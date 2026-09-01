import { eq } from "drizzle-orm";

import { db as defaultDb } from "./index";
import {
  knowledgeCollections,
  knowledgeDocuments,
  knowledgeRoles,
  organizationSettings,
  roleStarterPrompts,
  roles,
  users,
} from "./schema";
import { GLOBAL_SYSTEM_PROMPT, KNOWLEDGE_SEEDS, ROLE_SEEDS } from "./seed-data";

export async function seed(db = defaultDb) {
  const roleIds = new Map<string, string>();

  for (const role of ROLE_SEEDS) {
    const existing = (await db.select().from(roles).where(eq(roles.slug, role.slug)))[0];
    const values = {
      slug: role.slug,
      name: role.name,
      description: role.description,
      systemPrompt: role.systemPrompt,
      welcomeMd: role.welcomeMd,
      isSystem: true,
      updatedAt: new Date(),
    };

    const row = existing
      ? (await db.update(roles).set(values).where(eq(roles.id, existing.id)).returning())[0]
      : (await db.insert(roles).values(values).returning())[0];

    if (!row) {
      throw new Error(`Falha ao gravar cargo ${role.slug}`);
    }

    roleIds.set(role.slug, row.id);
    await db.delete(roleStarterPrompts).where(eq(roleStarterPrompts.roleId, row.id));
    await db.insert(roleStarterPrompts).values(
      role.starters.map((starter, index) => ({
        roleId: row.id,
        title: starter.title,
        prompt: starter.prompt,
        sortOrder: index,
      })),
    );
  }

  const settings = (await db.select().from(organizationSettings).limit(1))[0];
  const settingsValues = {
    name: "Nexo",
    globalSystemPrompt: GLOBAL_SYSTEM_PROMPT,
    defaultModel: "z-ai/glm-5.3-flash",
    fallbackModel: "z-ai/glm-5.3-flash",
    allowedModels: ["z-ai/glm-5.3-flash"],
    updatedAt: new Date(),
  };

  if (settings) {
    await db
      .update(organizationSettings)
      .set(settingsValues)
      .where(eq(organizationSettings.id, settings.id));
  } else {
    await db.insert(organizationSettings).values(settingsValues);
  }

  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const adminRoleId = roleIds.get("admin");

  if (adminEmail && adminPassword && adminRoleId) {
    const passwordHash = await Bun.password.hash(adminPassword, { algorithm: "argon2id" });
    const existingAdmin = (await db.select().from(users).where(eq(users.email, adminEmail)))[0];
    if (existingAdmin) {
      await db
        .update(users)
        .set({
          isAdmin: true,
          roleId: adminRoleId,
          status: "active",
          emailVerified: true,
          // garante 1000 créditos iniciais (1000 créditos = US$1)
          creditBalance:
            (existingAdmin as unknown as { creditBalance: string | null }).creditBalance ??
            "1000.0000",
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingAdmin.id));
    } else {
      await db.insert(users).values({
        name: "Admin",
        email: adminEmail,
        passwordHash,
        isAdmin: true,
        roleId: adminRoleId,
        status: "active",
        emailVerified: true,
        creditBalance: "1000.0000",
        onboardedAt: new Date(),
      });
    }
  }

  // garante que usuários antigos ganhem saldo inicial e backfill do ledger
  const allUsers = await db.select().from(users);
  for (const u of allUsers) {
    const bal = (u as unknown as { creditBalance: string | null }).creditBalance;
    if (bal === null || bal === undefined) {
      await db.update(users).set({ creditBalance: "1000.0000" }).where(eq(users.id, u.id));
    }
  }

  // lote 4: bases de conhecimento mínimas por cargo
  for (const collectionSeed of KNOWLEDGE_SEEDS) {
    const existingCollection = (
      await db
        .select()
        .from(knowledgeCollections)
        .where(eq(knowledgeCollections.slug, collectionSeed.slug))
    )[0];
    const collection = existingCollection
      ? existingCollection
      : (
          await db
            .insert(knowledgeCollections)
            .values({
              slug: collectionSeed.slug,
              name: collectionSeed.name,
              description: collectionSeed.description,
              visibility: collectionSeed.visibility,
            })
            .returning()
        )[0];
    if (!collection) {
      throw new Error(`Falha ao gravar base ${collectionSeed.slug}`);
    }

    await db.delete(knowledgeRoles).where(eq(knowledgeRoles.collectionId, collection.id));
    const linkedRoleIds = collectionSeed.roleSlugs
      .map((slug) => roleIds.get(slug))
      .filter((id): id is string => Boolean(id));
    if (linkedRoleIds.length) {
      await db
        .insert(knowledgeRoles)
        .values(linkedRoleIds.map((roleId) => ({ collectionId: collection.id, roleId })));
    }

    for (const docSeed of collectionSeed.documents) {
      const existingDoc = (
        await db
          .select()
          .from(knowledgeDocuments)
          .where(eq(knowledgeDocuments.collectionId, collection.id))
      ).find((doc) => doc.title === docSeed.title);
      if (existingDoc) {
        continue;
      }
      await db.insert(knowledgeDocuments).values({
        collectionId: collection.id,
        title: docSeed.title,
        bodyMd: docSeed.bodyMd,
        sourceType: "markdown",
        checksum: Bun.SHA256.hash(docSeed.bodyMd, "hex"),
      });
    }
  }

  return { roleIds };
}

if (import.meta.main) {
  await seed();
  console.log("seed ok");
}
