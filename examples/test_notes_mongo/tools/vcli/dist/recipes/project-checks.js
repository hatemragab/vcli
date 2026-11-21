/** Scaffold operations retain the same mandatory gates as project generation. */
export function projectChecks() {
    return [
        {
            name: 'architecture',
            command: 'npm',
            args: ['run', 'check:architecture'],
        },
        { name: 'database', command: 'npm', args: ['run', 'check:database'] },
        { name: 'lint', command: 'npm', args: ['run', 'lint'] },
        { name: 'typecheck', command: 'npm', args: ['run', 'typecheck'] },
    ];
}
//# sourceMappingURL=project-checks.js.map