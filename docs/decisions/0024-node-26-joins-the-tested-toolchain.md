# 0024 node 26 joins the tested toolchain

Status: accepted, 2026-11-10 (0.9.1). Extends [ADR 0013](0013-node-first-toolchain.md). ([#130](https://github.com/azusachino/tsuzuri/issues/130))

## context

ADR 0013 fixed the support floor at `node >= 22` and had CI run the suite on Node 22 and 24. The development toolchain then pinned `node = "24.19.0"` to a patch that was never installed on the owner's machine, so `mise ls` reported it missing, mise activated no node at all, and every local gate silently ran on whatever `node` the shell found — a nix-provided 24.22.1 in practice. Local evidence and CI evidence were therefore produced by different toolchains without anyone noticing.

Node 26 is the current line. The floor stays where it is: nobody should need a new Node to install tsuzuri.

## decision

- **The development toolchain pins `node = "26"`, a minor rather than a patch,** so a missing patch cannot silently disable the pin. The other tools in that file follow the same rule, matching the workstation root.
- **CI runs `make validate` on Node 22, 24 and 26,** the floor, the previous line and the current line. The floor is tested as a promise, not as a preference.
- **`engines` is unchanged,** `node >= 22`, and Bun stays a supported fast path under [ADR 0006](0006-portable-core-and-fallback-chains.md).

## alternatives considered

- **Test only the floor and the current line (22 and 26):** rejected; 24 is still maintained, the extra job costs about a minute, and the bracket would hide a regression that only appears on 24.
- **Keep three tested versions but pin development to 24:** rejected; the pin exists to make local runs match the current line, and the installed-patch failure is what surfaced the mismatch.
- **Also raise `engines` to `>= 26`:** rejected; nothing in the code requires it, and the package is a vault client people install, not a service the owner operates.

## consequences

Local `make check` runs on the current line, CI proves the floor still works, and a missing pin now fails loudly instead of falling through to the shell. Contributors install one more Node version. Pin a tool to a minor everywhere it appears, because a patch pin that is absent is indistinguishable from no pin.
