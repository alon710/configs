import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface ReviewComment {
  databaseId: number;
  author: { login: string } | null;
  createdAt: string;
  url: string;
  body: string;
  replyTo: { databaseId: number } | null;
}

interface CommentConnection {
  nodes: ReviewComment[];
  pageInfo: PageInfo;
}

interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  comments: CommentConnection;
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: 'utf8' });
  if (result.status !== 0) fail(result.stderr.trim() || `${command} exited with ${result.status ?? 1}`);
  return result.stdout;
}

function gitRoot(): string {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  const root = result.stdout.trim();
  if (result.status !== 0 || !root) fail('run this command from inside a Git repository');
  return root;
}

function json<T>(command: string, args: string[]): T {
  return JSON.parse(run(command, args)) as T;
}

const DEFAULT_REPLY_DIR = '.context/pr-reviews';
const repositoryRoot = gitRoot();
const [prArgument, action, threadId, ...flags] = process.argv.slice(2);
if (!prArgument || !action) {
  fail(
    'usage: review-threads.ts <pr-number> <inventory|verify|reply-resolve> [thread-id] ' +
      '[--body-file <path>] [--reply-dir <dir>] [--execute --confirm RESOLVE:<thread-id>]',
  );
}
const prNumber = Number(prArgument);
if (!Number.isInteger(prNumber) || prNumber <= 0) fail('PR number must be a positive integer');

const repository = json<{ nameWithOwner: string }>('gh', ['repo', 'view', '--json', 'nameWithOwner']);
const [owner, name] = repository.nameWithOwner.split('/');
if (!owner || !name) fail('could not determine repository owner and name');

const threadQuery = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{id isResolved isOutdated path line originalLine comments(first:100){nodes{databaseId author{login} createdAt url body replyTo{databaseId}} pageInfo{hasNextPage endCursor}}} pageInfo{hasNextPage endCursor}}}}}`;
const threadCommentsQuery = `query($threadId:ID!,$cursor:String){node(id:$threadId){... on PullRequestReviewThread{comments(first:100,after:$cursor){nodes{databaseId author{login} createdAt url body replyTo{databaseId}} pageInfo{hasNextPage endCursor}}}}}`;

function appendRemainingComments(thread: ReviewThread): void {
  if (thread.comments.pageInfo.hasNextPage && !thread.comments.pageInfo.endCursor) {
    fail(`missing comments cursor for thread ${thread.id}`);
  }
  let cursor = thread.comments.pageInfo.hasNextPage ? thread.comments.pageInfo.endCursor : null;
  while (cursor) {
    const result = json<{ data: { node: { comments: CommentConnection } | null } }>('gh', [
      'api',
      'graphql',
      '-f',
      `query=${threadCommentsQuery}`,
      '-f',
      `threadId=${thread.id}`,
      '-f',
      `cursor=${cursor}`,
    ]);
    if (!result.data.node) fail(`could not paginate comments for thread ${thread.id}`);
    const connection = result.data.node.comments;
    thread.comments.nodes.push(...connection.nodes);
    if (connection.pageInfo.hasNextPage && !connection.pageInfo.endCursor) {
      fail(`missing comments cursor for thread ${thread.id}`);
    }
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  }
}

function reviewThreads(): ReviewThread[] {
  const threads: ReviewThread[] = [];
  let cursor: string | null = null;
  do {
    const args = [
      'api',
      'graphql',
      '-f',
      `query=${threadQuery}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `name=${name}`,
      '-F',
      `number=${prNumber}`,
    ];
    if (cursor) args.push('-f', `cursor=${cursor}`);
    const result = json<{
      data: { repository: { pullRequest: { reviewThreads: { nodes: ReviewThread[]; pageInfo: PageInfo } } } };
    }>('gh', args);
    const connection = result.data.repository.pullRequest.reviewThreads;
    threads.push(...connection.nodes);
    if (connection.pageInfo.hasNextPage && !connection.pageInfo.endCursor) {
      fail(`missing review thread cursor for PR #${prNumber}`);
    }
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);
  for (const thread of threads) appendRemainingComments(thread);
  return threads;
}

function flagValue(flag: string): string | undefined {
  const index = flags.indexOf(flag);
  return index >= 0 ? flags[index + 1] : undefined;
}

function isWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

function replyBodyFile(path: string, replyDir: string): string {
  let allowedRoot: string;
  let candidate: string;
  try {
    allowedRoot = realpathSync(resolve(repositoryRoot, replyDir));
    candidate = realpathSync(resolve(repositoryRoot, path));
  } catch {
    fail(`--body-file must reference an existing file under ${replyDir}`);
  }
  if (!isWithin(allowedRoot, candidate)) fail(`--body-file must stay within ${replyDir}`);
  if (!statSync(candidate).isFile()) fail('--body-file must reference a regular file');
  const realRoot = realpathSync(repositoryRoot);
  if (isWithin(realRoot, candidate)) {
    const ignored = spawnSync('git', ['check-ignore', '-q', relative(realRoot, candidate)], { cwd: realRoot });
    if (ignored.status !== 0) {
      fail(`${path} is not git-ignored; ignore ${replyDir} or pass --reply-dir "$(mktemp -d)"`);
    }
  }
  return candidate;
}

if (action === 'inventory') {
  const issueComments = json<unknown[]>('gh', [
    'api',
    '--paginate',
    `repos/${owner}/${name}/issues/${prNumber}/comments?per_page=100`,
    '--slurp',
  ]).flat();
  const reviews = json<unknown[]>('gh', [
    'api',
    '--paginate',
    `repos/${owner}/${name}/pulls/${prNumber}/reviews?per_page=100`,
    '--slurp',
  ]).flat();
  console.log(JSON.stringify({ prNumber, issueComments, reviews, reviewThreads: reviewThreads() }, null, 2));
  process.exit(0);
}

if (action === 'verify') {
  const unresolved = reviewThreads().filter(thread => !thread.isResolved);
  if (unresolved.length) {
    console.error(JSON.stringify(unresolved.map(thread => ({ id: thread.id, path: thread.path, line: thread.line }))));
    fail(`${unresolved.length} review thread(s) remain unresolved`);
  }
  console.log('PASS: all review threads are resolved');
  process.exit(0);
}

if (action !== 'reply-resolve' || !threadId) fail('reply-resolve requires a review thread id');
const bodyPath = flagValue('--body-file');
if (!bodyPath) fail('reply-resolve requires --body-file <path>');
const replyDir = flagValue('--reply-dir') ?? DEFAULT_REPLY_DIR;
const body = readFileSync(replyBodyFile(bodyPath, replyDir), 'utf8').trim();
if (!body) fail('reply body cannot be empty');
const matchingThread = reviewThreads().find(thread => thread.id === threadId);
if (!matchingThread) fail(`thread ${threadId} does not belong to PR #${prNumber}`);
const validatedThreadId = matchingThread.id;

console.log(`Thread: ${validatedThreadId}`);
console.log(`Reply: ${body}`);
if (!flags.includes('--execute')) {
  console.log('DRY RUN ONLY: no reply posted and no thread resolved');
  process.exit(0);
}
const confirmIndex = flags.indexOf('--confirm');
if (confirmIndex < 0 || flags[confirmIndex + 1] !== `RESOLVE:${validatedThreadId}`) {
  fail(`requires --confirm RESOLVE:${validatedThreadId}`);
}

const replyMutation = `mutation($threadId:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId,body:$body}){comment{id url}}}`;
run('gh', [
  'api',
  'graphql',
  '-f',
  `query=${replyMutation}`,
  '-f',
  `threadId=${validatedThreadId}`,
  '-f',
  `body=${body}`,
]);
const resolveMutation = `mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id isResolved}}}`;
run('gh', ['api', 'graphql', '-f', `query=${resolveMutation}`, '-f', `threadId=${validatedThreadId}`]);
console.log(`PASS: replied to and resolved ${validatedThreadId}`);
