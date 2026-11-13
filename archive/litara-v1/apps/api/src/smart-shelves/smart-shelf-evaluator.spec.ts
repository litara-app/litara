import { buildBookWhere } from './smart-shelf-evaluator';

describe('buildBookWhere — filePath rule', () => {
  it('builds a files.some.filePath "contains" filter', () => {
    const where = buildBookWhere(
      [{ field: 'filePath', operator: 'contains', value: '/Sci-Fi/' }],
      'AND',
    );
    expect(where).toEqual({
      AND: [
        {
          files: {
            some: { filePath: { contains: '/Sci-Fi/', mode: 'insensitive' } },
          },
        },
      ],
    });
  });

  it('supports "startsWith" for filePath', () => {
    const where = buildBookWhere(
      [{ field: 'filePath', operator: 'startsWith', value: '/library/' }],
      'AND',
    );
    expect(where).toEqual({
      AND: [
        {
          files: {
            some: {
              filePath: { startsWith: '/library/', mode: 'insensitive' },
            },
          },
        },
      ],
    });
  });
});
