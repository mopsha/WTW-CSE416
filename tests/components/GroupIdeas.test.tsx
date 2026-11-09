import React from 'react';
import { GroupIdeas } from '@/components/GroupIdeas';
import { api } from '@/lib/api';
import type { GroupDetail } from '@/lib/groups';
import type { GroupIdea } from '@shared/api/groupIdeas.ts';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@/hooks/usePrivateRefresh', () => ({
  usePrivateRefresh: (load: () => void, clear: () => void) =>
    jest.requireActual('react').useEffect(() => {
      load();
      return clear;
    }, [load, clear]),
}));
jest.mock('@/lib/api', () => ({
  api: {
    listGroupIdeas: jest.fn(),
    createGroupIdea: jest.fn(),
    updateGroupIdea: jest.fn(),
    deleteGroupIdea: jest.fn(),
  },
}));
jest.mock('@/lib/confirm', () => ({ confirmAction: async () => true }));
jest.mock('@/components', () => ({
  Button: (p: object) => jest.requireActual('react').createElement('test-button', p),
  Card: ({ children }: any) => children,
  Chips: (p: object) => jest.requireActual('react').createElement('test-chips', p),
  ErrorState: (p: object) => jest.requireActual('react').createElement('test-error', p),
}));
jest.mock('@/components/TabUi', () => ({
  ListRow: (p: object) => jest.requireActual('react').createElement('test-row', p),
  SectionHeading: ({ right }: any) => right,
  Sheet: ({ visible, children }: any) => (visible ? children : null),
}));
const group: GroupDetail = { id: 'group', name: 'Crew', ownerId: 'owner', members: [], picks: [] };
const idea: GroupIdea = {
  id: 'idea',
  groupId: 'group',
  createdBy: 'me',
  name: 'Bowling',
  category: 'activity',
  description: null,
  locationText: null,
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
};
let tree: any;
const button = (label: string) =>
  tree.root.findAllByType('test-button').find((n: any) => n.props.label === label);
const field = (label: string) =>
  tree.root.findAllByProps({ accessibilityLabel: label }).find((n: any) => n.props.onChangeText);
async function mount(userId = 'me') {
  await act(async () => {
    tree = create(<GroupIdeas group={group} userId={userId} />);
  });
}
async function press(label: string) {
  await act(async () => button(label).props.onPress());
}
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(api.listGroupIdeas)
    .mockReset()
    .mockResolvedValue({ ideas: [idea] });
  jest.mocked(api.createGroupIdea).mockResolvedValue(idea);
  jest.mocked(api.updateGroupIdea).mockResolvedValue(idea);
  jest.mocked(api.deleteGroupIdea).mockResolvedValue({ status: 'ok' });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = undefined;
});
test('Group Ideas retains creating, viewing, editing and deleting through the group-scoped API', async () => {
  const created = { ...idea, id: 'created', name: 'Board games' };
  jest
    .mocked(api.listGroupIdeas)
    .mockResolvedValueOnce({ ideas: [idea] })
    .mockResolvedValueOnce({ ideas: [idea, created] })
    .mockResolvedValueOnce({ ideas: [idea, { ...created, name: 'Dinner' }] })
    .mockResolvedValueOnce({ ideas: [idea] });
  await mount();
  await press('Add idea');
  await act(async () => field('Idea name').props.onChangeText(' Board games '));
  await press('Save idea');
  expect(api.createGroupIdea).toHaveBeenCalledWith('group', {
    name: 'Board games',
    category: 'activity',
    description: null,
    locationText: null,
  });
  expect(tree.root.findAllByType('test-row').map((n: any) => n.props.title)).toContain(
    'Board games',
  );
  await act(async () =>
    tree.root
      .findAllByType('test-row')
      .find((n: any) => n.props.title === 'Board games')
      .props.onPress(),
  );
  expect(button('Edit idea')).toBeDefined();
  await press('Edit idea');
  await act(async () => field('Idea name').props.onChangeText('Dinner'));
  await press('Save idea');
  expect(api.updateGroupIdea).toHaveBeenCalledWith(
    'group',
    'created',
    expect.objectContaining({ name: 'Dinner' }),
  );
  const titles = () => tree.root.findAllByType('test-row').map((n: any) => n.props.title);
  expect(titles()).toContain('Dinner');
  expect(titles()).not.toContain('Board games');
  await act(async () =>
    tree.root
      .findAllByType('test-row')
      .find((n: any) => n.props.title === 'Dinner')
      .props.onPress(),
  );
  await press('Delete idea');
  expect(api.deleteGroupIdea).toHaveBeenCalledWith('group', 'created');
  expect(titles()).not.toContain('Dinner');
  expect(titles()).toEqual(['Bowling']);
});
test.each([
  ['owner', true],
  ['another-member', false],
])(
  'idea permissions remain creator-edit / creator-or-owner-delete: %s',
  async (user, canDelete) => {
    await mount(user as string);
    await act(async () => tree.root.findByType('test-row').props.onPress());
    expect(button('Edit idea')).toBeUndefined();
    expect(!!button('Delete idea')).toBe(canDelete);
    expect(button('Add idea')).toBeDefined();
  },
);
test('empty and failed loads retain creation/retry states, and invalid inputs do not send', async () => {
  jest.mocked(api.listGroupIdeas).mockRejectedValueOnce(new Error('Group unavailable'));
  await mount();
  expect(tree.root.findByType('test-error').props.message).toBe('Group unavailable');
  jest.mocked(api.listGroupIdeas).mockResolvedValueOnce({ ideas: [] });
  await act(async () => tree.root.findByType('test-error').props.onRetry());
  expect(JSON.stringify(tree.toJSON())).toContain('No ideas yet.');
  await press('Add idea');
  await press('Save idea');
  expect(api.createGroupIdea).not.toHaveBeenCalled();
  expect(tree.root.findByType('test-error').props.message).toContain('Name');
});

test('the dedicated Ideas view keeps Add idea available when the page already supplies its heading', async () => {
  await act(async () => {
    tree = create(<GroupIdeas group={group} userId="me" showHeading={false} />);
  });
  expect(button('Add idea')).toBeDefined();
  await press('Add idea');
  expect(field('Idea name')).toBeDefined();
});
