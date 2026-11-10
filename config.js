import z from '@deepseek-ai/schemastery';

// Paths and publishing identities are chosen by the installing user. Credentials
// stay in the host/CLI authorization store; this schema never accepts tokens.
export const Config = z.object({
  workspaceRoot: z.string().default('').description('Absolute workspace path for local test records. Empty uses the DSH process working directory. Changing this setting remounts the plugin.'),
  report: z.object({
    enabled: z.boolean().default(false).description('Enable optional Feishu/Lark publishing with your own authorized CLI identity.'),
    binary: z.string().default('lark-cli'),
    profile: z.string().default(''),
    expectedUserName: z.string().default(''),
    expectedOpenId: z.string().default(''),
    productDirectory: z.string().default(''),
    historyDirectory: z.string().default(''),
    directoryUrl: z.string().default(''),
    directoryKind: z.union(['product','history']).default('product'),
    directorySection: z.string().default(''),
    directoryTitle: z.string().default(''),
    directoryAppendSection: z.boolean().default(false),
    timeout: z.number().min(1000).max(120000).default(60000),
    writeTimeout: z.number().min(1000).max(900000).default(900000)
  }).default({})
});
