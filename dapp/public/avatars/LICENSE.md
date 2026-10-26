# Avatar artwork

The twelve avatars in this folder are 3D people from Microsoft's
[Fluent Emoji](https://github.com/microsoft/fluentui-emoji) set, used under
its MIT license (Copyright (c) Microsoft Corporation). They are copied here
once so the app never depends on a third-party request at runtime.

Each file is referenced by id from `src/lib/avatarPresets.ts` (`AVATAR_IMAGES`).
Replace a file to change the art; never reuse an id for a different face —
ids are stored on people's profiles.
