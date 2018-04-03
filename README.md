# clgen

## Install

```sh
npm i -g @aoki/clgen
```

### Setup Configuration by Environments Variables
| Name              | Description                  | Example              | Default      | Note                                              |
| ----------------- | ---------------------------- | -------------------- | ------------ | ------------------------------------------------- |
| `GITHUB_PROTOCOL` | Use protocol for GitHub API  | `http`               | `https`      | For GitHub Enterprise setting                     |
| `GITHUB_TOKEN`    |                              | `9uf23qoqfjoq4jtow`  | `-`          |                                                   |
| `GITHU_HOST`      | Specify GitHub Host          | `github.example.com` | `github.com` | For GitHub Enterprise setting                     |
| `JIRA_URL`        | Issue tracker JIRA URL       | `jira.example.com`   | `-`          |                                                   |
| `TICKET_REGEX`    | Ticket tag regex in PR title | `\[#(FOOBAR-\d+)]`   | `-`          | Match `[#FOOBAR-123][BUGFIX] This is sample task` |


## Development
```sh
 git clone https://github.com/ringohub/clgen.git
 npm i
 npm link
```
