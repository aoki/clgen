#!/usr/bin/env node

// TODO: Use meow
// TODO: Multiple Issue Tracker
// TODO: Load config from rc file or package.json
// TODO: Git repository dirty check
// TODO: Clone/Pull to current directory
// TODO: Add current timezone

const fs = require('fs');
const chalk = require('chalk');
const ora = require('ora');
const git = require('simple-git/promise')('/tmp');
const semver = require('semver');
const gitOriginParser = require('git-origin-parser');


const githubProtocol = process.env.GITHUB_PROTOCOL || 'https';
const githubHost = process.env.GITHUB_HOST || 'github.com';
const githubPathPrefix = process.env.GITHUB_HOST !== 'github.com' ? '/api/v3' : '';
const githubUrl = `${githubProtocol}://${githubHost}`;
const ticketUrl = `${process.env.JIRA_URL}/browse/`;
const ticketTagRegex = process.env.TICKET_REGEX || '';

const targetBranch = 'master';
const changelog = {
  backward: {
    type: 'BACKWARD',
    label: 'BACKWARDS INCOMPATIBILITIES',
    description: '',
    data: []
  },
  feature: {
    type: 'FEATURE',
    label: 'FEATURES',
    description: '',
    data: []
  },
  improvement: {
    type: 'IMPROVEMENT',
    label: 'IMPROVEMENTS',
    description: '',
    data: []
  },
  bugfix: {
    type: 'BUGFIX',
    label: 'BUG FIXES',
    description: '',
    data: []
  },
  plugin: {
    type: 'PLUGIN',
    label: 'PLUGIN CHANGES',
    description: '',
    data: []
  }
};
const noTagChangelog = [];

// @see https://octokit.github.io/rest.js/
const octokit = require('@octokit/rest')({
  host: githubHost,
  pathPrefix: githubPathPrefix,
  protocol: githubProtocol
});

async function loadConfig() {
  const origin = await require('simple-git/promise')('').listRemote(['--get-url']);
  const remote = gitOriginParser(origin);
  console.log(origin);
  return {
    origin: origin,
    owner: remote.org,
    repo: remote.repo
  };
}

(async () => {
  // TODO: Git repository is dirty?
  const config = await loadConfig();

  await cloneRepository(config);
  const latestTag = await getLatestTag();
  const prs = await (
    gatheringPullRequests(latestTag, config)
      .then(prs => extractPullRequestType(prs))
      .then(prs => extractTicketTags(prs))
      .then(prs => extractOtherTags(prs))
      .then(prs => generatePullRequestMarkdown(prs, config))
  );

  // Classify Pull Requests
  prs.filter(p => p.type).map(p => {
    changelog[p.type].data.push(p);
  });

  const title = generateTitleMarkdown(latestTag, changelog);
  const sections = generateChangeLogMarkdown(changelog);
  const md = `${title}\n${sections}`;

  if (fs.existsSync('CHANGELOG.md')) {
    const oldMd = fs.readFileSync('CHANGELOG.md');
    fs.writeFileSync('CHANGELOG.md', `${md}\n\n\n${oldMd}`);
  } else {
    console.warn('CHANGELOG.md does not exists. Create CHANGELOG.md');
    fs.writeFileSync('CHANGELOG.md', `${md}`);
  }

  if (noTagChangelog.length > 0) {
    console.log(chalk.yellow('Below pull requests did not written to the CHANGELOG owing to has not TYPE in the TITLE. If you want to add CHANGELOG fix a pull request title and retry this command.'));
    noTagChangelog.forEach(c => {
      console.log(`\t- ${c.ticket} ${c.title} #${c.number}`);
    });
  }

  console.log(chalk.green('+-----------------------------------+'));
  console.log(`${md}`);
  console.log(chalk.green('+-----------------------------------+'));

})();

function generateTitleMarkdown(latestTag, changelog) {
  // Generate markdown title
  const today = new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const newVersion = computeNewVersion(latestTag, changelog);
  return `## v${newVersion} (${today})`;
}

function generateChangeLogMarkdown(changelog) {
  // Generate markdown changelog
  return Object.keys(changelog).map(type => {
    const cl = changelog[type];
    if (cl.data.length === 0) return '';

    const sectionTitle = `### ${cl.label}`;
    const prList = cl.data.map(pr => {
      return `- ${pr.markdown}`
    }).join('\n');

    return `\n${sectionTitle}\n${prList}\n`;
  }).join('');
}

function computeNewVersion(latestVersion, changelog) {
  if (changelog.backward.data.length > 0) {
    return semver(latestVersion).inc('minor');
  } else {
    return semver(latestVersion).inc('patch');
  }
}

function generatePullRequestMarkdown(prs, config) {
  const repo = config.repo;
  const owner = config.owner;
  return prs.map(p => {
    const prLink = `${githubUrl}/${owner}/${repo}/pull/${p.number}`;
    const ticketLink = `${ticketUrl}${p.ticket}`;
    const ticketMd = p.ticket ? `[\`[#${p.ticket}]\`](${ticketLink})` : '';
    const prLinkMd = p.number ? `[#${p.number}](${prLink})` : '';
    p.markdown = `${ticketMd} ${p.title} ${prLinkMd}`;
    return p;
  });
}

async function cloneRepository(config) {
  // Clone Repository
  const repo = config.repo;
  const owner = config.owner;
  if (fs.existsSync(`/tmp/${repo}`)) {
    const spinner = ora(`Pulling git repository: ${owner}/${repo}`).start();
    await git.cwd(`/tmp/${repo}`);
    await git.pull('origin', 'master');
    await git.pull('origin', 'master', '--tags');
    spinner.succeed();
  } else {
    const spinner = ora(`Cloning repository: ${owner}/${repo}`).start();
    // Simple-git only http(s) protocol.
    await git.clone(`${githubUrl}/${config.owner}/${config.repo}`);
    await git.cwd(`/tmp/${repo}`);
    spinner.succeed();
  }
}

async function getLatestTag() {
  // Get previous tag
  const spinner = ora('Getting latest tag.').start();
  const latestTag = (await git.tags()).latest;
  spinner.succeed(`Getting latest tag: ${chalk.green.bold(latestTag)}`);
  return latestTag
}

// Get Pull Request Number
async function gatheringPullRequests(latestTag, config) {
  const owner = config.owner;
  const repo = config.repo;
  const spinner = ora('Gathering pull requests').start();
  const PRMessageRegex = new RegExp('^Merge pull request #(\\d+) .*');
  const logs = await git.log({from: latestTag, to: 'HEAD'});
  const pullRequestNumbers = logs.all.filter(commit => {
    return (commit.message.match(PRMessageRegex));
  }).map(pr => {
    return {
      message: pr.message,
      number: pr.message.match(PRMessageRegex)[1]
    };
  });
  const prs = (await Promise.all(pullRequestNumbers.map(pr => {
    return octokit.pullRequests.get({owner, repo, number: pr.number});
  }))).filter(e => {
    return e.data.base.ref === targetBranch;
  }).map(e => {
    return {
      title: e.data.title.trim(),
      number: e.data.number
    };
  });
  spinner.succeed();

  prs.forEach(r => {
    console.log(`${chalk.yellow(`#${r.number}`)}\t${r.title}`);
  });
  return prs;
}

//Extract PR by changelog types
function extractPullRequestType(prs) {
  const spinner = ora('Extracting pull requests by changelog tags').start();
  const types = Object.keys(changelog);
  const typeRegex = new RegExp(`\\[(${types.join('|')})]`, 'i');
  const res = prs.map(r => {
    const res = r.title.match(typeRegex);
    if (res) {
      const typeTag = res[0];
      const type = r.title.match(typeRegex)[1].toLowerCase();
      r.title = r.title.replace(typeTag, '').trim();
      r.type = type;
    } else {
      r.type = null;
      noTagChangelog.push(r);
    }
    return r
  });
  spinner.succeed();
  console.log(`  Tag types: ${chalk.blue.bold(types.join(', '))}`);
  return res;
}

/**
 *  Extract Ticket Tags
 */
function extractTicketTags(prs) {
  const spinner = ora('Extracting ticket tags').start();
  const extractTicketTagRegex = new RegExp(ticketTagRegex);
  const res = prs.map(r => {
    const matchResult = r.title.match(extractTicketTagRegex);
    r.ticket = matchResult ? matchResult[1] : null;
    r.title = r.title.replace(extractTicketTagRegex, '').trim();
    return r;
  });
  spinner.succeed();
  return res;
}

/**
 * Extract other tags from PR
 */
function extractOtherTags(prs) {
  const spinner = ora('Extracting other tags').start();
  const otherTagRegex = new RegExp(`\\[.*?]`, 'g');
  const res = prs.map(r => {
    r.otherTags = r.title.match(otherTagRegex);
    r.title = r.title.replace(otherTagRegex, '').trim();
    return r;
  });
  spinner.succeed();
  return res;
}
