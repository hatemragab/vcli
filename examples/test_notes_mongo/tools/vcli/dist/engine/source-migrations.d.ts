export declare const COPIED_MAIL_MIGRATION = "copied.mail-subject-controls-v1";
export declare const COPIED_MAIL_PATH = "src/modules/mail/render-message.ts";
export declare const STARTER_MIGRATIONS: {
    readonly 'copied.root-build-ignore': {
        readonly path: ".gitignore";
        readonly oldSection: "node_modules/\ndist/\nvar/\n.env\n.env.*\n!.env.*.example\n.vcli/\n*.tgz\n";
        readonly newSection: "node_modules/\n/dist/\nvar/\n.env\n.env.*\n!.env.*.example\n.vcli/\n*.tgz\n";
        readonly instruction: "In the customized .gitignore, anchor the app build rule to /dist/ so Git includes vendored CLI and auth-runtime files.";
    };
    readonly 'copied.claude-instructions-import': {
        readonly path: "CLAUDE.md";
        readonly oldSection: "Read AGENTS.md for selected capabilities, ownership and verification commands.\n";
        readonly newSection: "@AGENTS.md\n";
        readonly instruction: "In the customized CLAUDE.md, import the shared project rules with @AGENTS.md.";
    };
};
export declare const MAIL_RENDERING_OLD = "export function renderMessage(message: MailMessage): MailMessage {\n  if (\n    !message ||\n    !validMailAddress(message.to) ||\n    typeof message.operationId !== 'string' ||\n    !/^[A-Za-z0-9_-]{1,128}$/.test(message.operationId) ||\n    typeof message.subject !== 'string' ||\n    !message.subject ||\n    /[\\r\\n\\0]/.test(message.subject) ||\n    message.subject.length > 200 ||\n    typeof message.text !== 'string' ||\n    !message.text ||\n    message.text.length > 32768 ||\n    /\\0/.test(message.text) ||\n    !['verification', 'password-reset', 'notification'].includes(\n      message.purpose,\n    )\n  )\n    throw new ApplicationError('INVALID_MAIL_MESSAGE', 400);\n  return {\n    operationId: message.operationId,\n    purpose: message.purpose,\n    to: message.to,\n    subject: message.subject,\n    text: message.text,\n    html: `<div style=\"white-space:pre-wrap\">${escapeHtml(message.text)}</div>`,\n  };\n}\n";
export declare const MAIL_RENDERING_NEW = "export function renderMessage(message: MailMessage): MailMessage {\n  if (\n    !message ||\n    !validMailAddress(message.to) ||\n    typeof message.operationId !== 'string' ||\n    !/^[A-Za-z0-9_-]{1,128}$/.test(message.operationId) ||\n    typeof message.subject !== 'string' ||\n    !message.subject ||\n    // eslint-disable-next-line no-control-regex -- Reject email header control characters.\n    /[\\u0000-\\u001f\\u007f]/.test(message.subject) ||\n    message.subject.length > 200 ||\n    typeof message.text !== 'string' ||\n    !message.text ||\n    message.text.length > 32768 ||\n    /\\0/.test(message.text) ||\n    !['verification', 'password-reset', 'notification'].includes(\n      message.purpose,\n    )\n  )\n    throw new ApplicationError('INVALID_MAIL_MESSAGE', 400);\n  return {\n    operationId: message.operationId,\n    purpose: message.purpose,\n    to: message.to,\n    subject: message.subject,\n    text: message.text,\n    html: `<div style=\"white-space:pre-wrap\">${escapeHtml(message.text)}</div>`,\n  };\n}\n";
export interface SourceMigrationDefinition {
    id: string;
    path: string;
    oldSection: string;
    newSection: string;
    patch: string;
}
export interface SourceMigrationPreview {
    status: 'supported' | 'already-applied' | 'manual';
    content?: string;
}
/** Only the copied files reviewed for private upgrades are eligible for automatic edits. */
export declare function getSourceMigration(id: string): SourceMigrationDefinition;
/** Supports exactly one recognized function; adjacent custom source remains byte-for-byte. */
export declare function previewSourceMigration(id: string, content: string): SourceMigrationPreview;
