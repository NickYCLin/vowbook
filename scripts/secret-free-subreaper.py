#!/usr/bin/env python3
"""Exec a command as Linux's child subreaper for dotenv-safe process cleanup."""

import ctypes
import os
import sys

PR_SET_CHILD_SUBREAPER = 36


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: secret-free-subreaper.py <command> [args...]")
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))
    os.execvpe(sys.argv[1], sys.argv[1:], os.environ)


if __name__ == "__main__":
    main()
