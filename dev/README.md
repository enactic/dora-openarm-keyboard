# Development

## How to release

```bash
git clone git@github.com:enactic/dora-openarm-keyboard.git
cd dora-openarm-keyboard
dev/release.sh ${VERSION} # e.g. dev/release.sh 1.0.0
```

## How to work on a page without a dataflow

```bash
uv run python dev/fake_node.py
```

runs the real `WebTeleopServer` with no dora attached: it prints the key
events it receives and streams a colour-bar test card as video. Open
<http://127.0.0.1:8080/> for the keyboard page or
<http://127.0.0.1:8080/tablet/> for the touch controls (add `--host 0.0.0.0` to
reach it from a tablet on the LAN).
