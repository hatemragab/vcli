import ts from 'typescript';
import { EngineError } from './engine-error.js';

export const COPIED_MAIL_MIGRATION = 'copied.mail-subject-controls-v1';
export const COPIED_MAIL_PATH = 'src/modules/mail/render-message.ts';
export const STARTER_MIGRATIONS = {
  'copied.root-build-ignore': {
    path: '.gitignore',
    oldSection:
      'node_modules/\ndist/\nvar/\n.env\n.env.*\n!.env.*.example\n.vcli/\n*.tgz\n',
    newSection:
      'node_modules/\n/dist/\nvar/\n.env\n.env.*\n!.env.*.example\n.vcli/\n*.tgz\n',
    instruction:
      'In the customized .gitignore, anchor the app build rule to /dist/ so Git includes vendored CLI and auth-runtime files.',
  },
  'copied.claude-instructions-import': {
    path: 'CLAUDE.md',
    oldSection:
      'Read AGENTS.md for selected capabilities, ownership and verification commands.\n',
    newSection: '@AGENTS.md\n',
    instruction:
      'In the customized CLAUDE.md, import the shared project rules with @AGENTS.md.',
  },
} as const;
type StarterMigrationId = keyof typeof STARTER_MIGRATIONS;
export const MAIL_RENDERING_OLD =
  "export function renderMessage(message: MailMessage): MailMessage {\n  if (\n    !message ||\n    !validMailAddress(message.to) ||\n    typeof message.operationId !== 'string' ||\n    !/^[A-Za-z0-9_-]{1,128}$/.test(message.operationId) ||\n    typeof message.subject !== 'string' ||\n    !message.subject ||\n    /[\\r\\n\\0]/.test(message.subject) ||\n    message.subject.length > 200 ||\n    typeof message.text !== 'string' ||\n    !message.text ||\n    message.text.length > 32768 ||\n    /\\0/.test(message.text) ||\n    !['verification', 'password-reset', 'notification'].includes(\n      message.purpose,\n    )\n  )\n    throw new ApplicationError('INVALID_MAIL_MESSAGE', 400);\n  return {\n    operationId: message.operationId,\n    purpose: message.purpose,\n    to: message.to,\n    subject: message.subject,\n    text: message.text,\n    html: `<div style=\"white-space:pre-wrap\">${escapeHtml(message.text)}</div>`,\n  };\n}\n";
export const MAIL_RENDERING_NEW =
  "export function renderMessage(message: MailMessage): MailMessage {\n  if (\n    !message ||\n    !validMailAddress(message.to) ||\n    typeof message.operationId !== 'string' ||\n    !/^[A-Za-z0-9_-]{1,128}$/.test(message.operationId) ||\n    typeof message.subject !== 'string' ||\n    !message.subject ||\n    // eslint-disable-next-line no-control-regex -- Reject email header control characters.\n    /[\\u0000-\\u001f\\u007f]/.test(message.subject) ||\n    message.subject.length > 200 ||\n    typeof message.text !== 'string' ||\n    !message.text ||\n    message.text.length > 32768 ||\n    /\\0/.test(message.text) ||\n    !['verification', 'password-reset', 'notification'].includes(\n      message.purpose,\n    )\n  )\n    throw new ApplicationError('INVALID_MAIL_MESSAGE', 400);\n  return {\n    operationId: message.operationId,\n    purpose: message.purpose,\n    to: message.to,\n    subject: message.subject,\n    text: message.text,\n    html: `<div style=\"white-space:pre-wrap\">${escapeHtml(message.text)}</div>`,\n  };\n}\n";
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
export function getSourceMigration(id: string): SourceMigrationDefinition {
  if (Object.hasOwn(STARTER_MIGRATIONS, id))
    return { id, ...STARTER_MIGRATIONS[id as StarterMigrationId], patch: '' };
  if (id !== COPIED_MAIL_MIGRATION)
    throw new EngineError(
      'INVALID_PLAN',
      'migration',
      'Select an explicitly supported copied-source migration ID.',
    );
  return {
    id,
    path: COPIED_MAIL_PATH,
    oldSection: MAIL_RENDERING_OLD,
    newSection: MAIL_RENDERING_NEW,
    patch: [
      '# DEMONSTRATION advisory fixture; manually review against customized source.',
      '--- a/' + COPIED_MAIL_PATH,
      '+++ b/' + COPIED_MAIL_PATH,
      `@@ -1,${MAIL_RENDERING_OLD.trimEnd().split('\n').length} +1,${MAIL_RENDERING_NEW.trimEnd().split('\n').length} @@ renderMessage — manual review`,
      ...MAIL_RENDERING_OLD.trimEnd()
        .split('\n')
        .map((line) => '-' + line),
      ...MAIL_RENDERING_NEW.trimEnd()
        .split('\n')
        .map((line) => '+' + line),
      '',
    ].join('\n'),
  };
}

/** Supports exactly one recognized function; adjacent custom source remains byte-for-byte. */
export function previewSourceMigration(
  id: string,
  content: string,
): SourceMigrationPreview {
  const migration = getSourceMigration(id);
  if (id !== COPIED_MAIL_MIGRATION) {
    if (content === migration.newSection)
      return { status: 'already-applied', content };
    if (content === migration.oldSection)
      return { status: 'supported', content: migration.newSection };
    return { status: 'manual' };
  }
  const source = ts.createSourceFile(
    migration.path,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations = source.statements.filter(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'renderMessage',
  );
  if (declarations.length !== 1) return { status: 'manual' };
  const declaration = declarations[0]!;
  if (
    !declaration.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  )
    return { status: 'manual' };
  const actual = declaration.getText(source);
  if (actual === migration.newSection.trimEnd())
    return { status: 'already-applied', content };
  if (actual !== migration.oldSection.trimEnd()) return { status: 'manual' };
  return {
    status: 'supported',
    content:
      content.slice(0, declaration.getStart(source)) +
      migration.newSection.trimEnd() +
      content.slice(declaration.end),
  };
}
