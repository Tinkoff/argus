# argus

## Roadmap
- [X] edit already created message instead of new one's creation
- [X] refresh comment with loading status (if it exists) on _workflow_run.requested_
- [X] listen closing/merge of PR and delete saved screenshots diff folder
- [X] edit report when PR is closed (smth like: 'PR was closed and all saved screenshots deleted')
- [X] make configurable param to detect
  after which workflow bot should look for artifacts zip with test screenshots
  (parsing workflow name and skip workflows with no tests)
- [X] write **Bot configurations** in root README and describe about toml file and all defaults params
- [ ] check all permissions again (with turning extra off) and update app.yml file
- [ ] write **About Permissions** in root README and describe why bot need every of them
- [ ] deploy to glitch
- [ ] test first draft of app


# Bot configurations
Bot has configurable params which can be unique for every Github repository.
Every param is optional, and you can skip this section if default configuration satisfies you.

To pass custom params for bot you should create `argus-configs.toml` file in the root directory.

**Example of `argus-configs.toml` file content** (you can paste it as it is) and **default values** of each param:
```yaml
# array of regular expression strings to match workflow names
# which should be watched by bot
workflowWithTests = [
  '.*test.*', # all workflows with sub-string "test" in their names will be watched by bot 
]

# TODO add support of screenshotsDiffsPaths
# array of regular expression strings to match images inside artifacts (by their path or file name)
# which shows diffence between two screenshot and which will be added to bot report comment
screenshotsDiffsPaths = [
  '.*__diff_output__.*', # it is default cypress folder name into which snapshot diffs are put
]

# More configurable params will be added soon (if necessary)
```

> A GitHub App built with [Probot](https://github.com/probot/probot) that TODO

## Setup

```sh
# Install dependencies
npm install

# Run the bot
npm start
```

## Docker

```sh
# 1. Build container
docker build -t argus .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> argus
```

## Contributing

If you have suggestions for how argus could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2021 Barsukov Nikita <nikita.s.barsukov@gmail.com>
