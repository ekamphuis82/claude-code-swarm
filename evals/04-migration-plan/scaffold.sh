#!/usr/bin/env bash
set -euo pipefail
for p in $(seq 1 8); do
  d="packages/pkg$p"
  mkdir -p "$d/src" "$d/test" "$d/__mocks__"
  cat > "$d/src/index.ts" <<EOF
import { getUserById } from '@acme/users'

export async function load$p(id: string) {
  const user = await getUserById(id)
  const owner = await getUserById(user.ownerId)
  return { user, owner, check: await getUserById(id) }
}
EOF
  cat > "$d/test/index.test.ts" <<EOF
import { getUserById } from '@acme/users'
import { load$p } from '../src'

test('load$p', async () => {
  vi.mocked(getUserById).mockResolvedValue({ id: '1', ownerId: '2' })
  await load$p('1')
  expect(getUserById).toHaveBeenCalledTimes(3)
})
EOF
  printf "export const getUserById = vi.fn()\n" > "$d/__mocks__/users.ts"
done
