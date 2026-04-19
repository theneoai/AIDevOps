import { createMcpServer } from '../server';

describe('createMcpServer', () => {
  it('returns a defined server instance', () => {
    const server = createMcpServer();
    expect(server).toBeDefined();
  });
});
