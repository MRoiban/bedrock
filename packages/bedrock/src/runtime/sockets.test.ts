import { expect, test } from 'bun:test';
import { createApplicationSockets } from './sockets';
import { socket } from '../config';

test('upgrade consumption cannot erase handler or bearer revalidation request metadata', async () => {
  let url = 'http://localhost/host?workspace=large';
  const headers = new Headers({ authorization: 'Bearer original', 'x-test': 'kept' });
  const request = { get url() { return url; }, method: 'GET', headers } as Request;
  let data: any;
  const sockets = createApplicationSockets({ name: 'original', sockets: { '/host': socket({ message() {} }) } }, {
    identify: async () => ({ user: null, token: null }),
    detached: async (retained: Request, fn: (ctx: any) => unknown) => fn({ request: retained }),
  } as any);
  await sockets.upgrade('/host', request, { upgrade(_request: Request, options: any) { data = options.data; url = ''; headers.delete('x-test'); return true; } } as any);
  expect(data.context.request.url).toBe('http://localhost/host?workspace=large');
  expect(data.context.request.headers.get('x-test')).toBe('kept');
  expect(data.request).toBe(data.context.request);
  expect(data.request.headers.get('authorization')).toBe('Bearer original');
});
