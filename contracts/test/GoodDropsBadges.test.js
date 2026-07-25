const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

// Full coverage for the soulbound badge contract: authorized minting, replay
// resistance (cross-chain / cross-contract / same-contract), soulbound transfer
// bans, burn semantics, ERC-5192, metadata, admin controls, and UUPS upgrades.
describe("GoodDropsBadges", function () {
  let badges, owner, signer, relayer, alice, bob, other;

  // Compute the badge type id exactly as the server will: uint256(keccak256(slug)).
  function typeId(slug) {
    return BigInt(ethers.keccak256(ethers.toUtf8Bytes(slug)));
  }

  async function chainId() {
    return (await ethers.provider.getNetwork()).chainId;
  }

  // Build the badgeSigner authorization for {to, badgeTypeId, deadline}.
  async function authorize({ to, badgeTypeId, deadline, contract, cid, who }) {
    const c = contract ?? (await badges.getAddress());
    const id = cid ?? (await chainId());
    const digest = ethers.solidityPackedKeccak256(
      ["string", "uint256", "address", "address", "uint256", "uint256"],
      ["GOODDROPS_BADGE", id, c, to, badgeTypeId, deadline],
    );
    // EIP-191 personal_sign over the raw digest bytes (matches toEthSignedMessageHash).
    return (who ?? signer).signMessage(ethers.getBytes(digest));
  }

  async function future(secs = 3600) {
    return (await ethers.provider.getBlock("latest")).timestamp + secs;
  }

  beforeEach(async () => {
    [owner, signer, relayer, alice, bob, other] = await ethers.getSigners();
    const Badges = await ethers.getContractFactory("GoodDropsBadges");
    badges = await upgrades.deployProxy(
      Badges,
      [owner.address, signer.address, "https://gooddrops.xyz/api/badges/meta/"],
      { initializer: "initialize", kind: "uups", unsafeAllow: ["constructor"] },
    );
    await badges.waitForDeployment();
  });

  // ─── Init ────────────────────────────────────────────────────────────────
  describe("initialize", () => {
    it("sets name, symbol, owner, signer", async () => {
      expect(await badges.name()).to.equal("GoodDrops Badges");
      expect(await badges.symbol()).to.equal("GDBADGE");
      expect(await badges.owner()).to.equal(owner.address);
      expect(await badges.badgeSigner()).to.equal(signer.address);
    });
    it("rejects zero owner or signer", async () => {
      const Badges = await ethers.getContractFactory("GoodDropsBadges");
      await expect(
        upgrades.deployProxy(Badges, [ethers.ZeroAddress, signer.address, ""], {
          initializer: "initialize", kind: "uups", unsafeAllow: ["constructor"],
        }),
      ).to.be.reverted;
    });
    it("cannot be re-initialized", async () => {
      await expect(
        badges.initialize(owner.address, signer.address, ""),
      ).to.be.revertedWithCustomError(badges, "InvalidInitialization");
    });
  });

  // ─── Minting ─────────────────────────────────────────────────────────────
  describe("mint", () => {
    it("mints a badge with a valid signature (relayer submits, hunter receives)", async () => {
      const id = typeId("first-hunt");
      const deadline = await future();
      const sig = await authorize({ to: alice.address, badgeTypeId: id, deadline });

      await expect(badges.connect(relayer).mint(alice.address, id, deadline, sig))
        .to.emit(badges, "BadgeMinted").withArgs(alice.address, id, 1)
        .and.to.emit(badges, "Locked").withArgs(1);

      expect(await badges.ownerOf(1)).to.equal(alice.address);
      expect(await badges.balanceOf(alice.address)).to.equal(1);
      expect(await badges.typeOf(1)).to.equal(id);
      expect(await badges.hasBadge(alice.address, id)).to.equal(true);
      expect(await badges.tokenCount()).to.equal(1);
    });

    it("token ids start at 1 and increment across mints/types", async () => {
      const d = await future();
      await badges.mint(alice.address, typeId("a"), d, await authorize({ to: alice.address, badgeTypeId: typeId("a"), deadline: d }));
      await badges.mint(alice.address, typeId("b"), d, await authorize({ to: alice.address, badgeTypeId: typeId("b"), deadline: d }));
      await badges.mint(bob.address,   typeId("a"), d, await authorize({ to: bob.address,   badgeTypeId: typeId("a"), deadline: d }));
      expect(await badges.tokenCount()).to.equal(3);
      expect(await badges.ownerOf(2)).to.equal(alice.address);
      expect(await badges.ownerOf(3)).to.equal(bob.address);
    });

    it("rejects a signature from a non-signer", async () => {
      const id = typeId("x"); const d = await future();
      const sig = await authorize({ to: alice.address, badgeTypeId: id, deadline: d, who: other });
      await expect(badges.mint(alice.address, id, d, sig))
        .to.be.revertedWithCustomError(badges, "InvalidSignature");
    });

    it("rejects an expired authorization", async () => {
      const id = typeId("x");
      const past = (await ethers.provider.getBlock("latest")).timestamp - 1;
      const sig = await authorize({ to: alice.address, badgeTypeId: id, deadline: past });
      await expect(badges.mint(alice.address, id, past, sig))
        .to.be.revertedWithCustomError(badges, "SignatureExpired");
    });

    it("prevents minting the same badge type twice to one wallet (same-contract replay)", async () => {
      const id = typeId("first-hunt"); const d = await future();
      const sig = await authorize({ to: alice.address, badgeTypeId: id, deadline: d });
      await badges.mint(alice.address, id, d, sig);
      await expect(badges.mint(alice.address, id, d, sig))
        .to.be.revertedWithCustomError(badges, "AlreadyHasBadge");
    });

    it("rejects a signature tampered to target a different recipient", async () => {
      const id = typeId("x"); const d = await future();
      const sig = await authorize({ to: alice.address, badgeTypeId: id, deadline: d });
      await expect(badges.mint(bob.address, id, d, sig))
        .to.be.revertedWithCustomError(badges, "InvalidSignature");
    });

    it("rejects a signature bound to a different badge type", async () => {
      const d = await future();
      const sig = await authorize({ to: alice.address, badgeTypeId: typeId("a"), deadline: d });
      await expect(badges.mint(alice.address, typeId("b"), d, sig))
        .to.be.revertedWithCustomError(badges, "InvalidSignature");
    });

    it("rejects a signature forged for a DIFFERENT chain id (cross-chain replay)", async () => {
      const id = typeId("x"); const d = await future();
      const wrongChain = await authorize({ to: alice.address, badgeTypeId: id, deadline: d, cid: 999999n });
      await expect(badges.mint(alice.address, id, d, wrongChain))
        .to.be.revertedWithCustomError(badges, "InvalidSignature");
    });

    it("rejects a signature forged for a DIFFERENT contract (cross-contract replay)", async () => {
      const id = typeId("x"); const d = await future();
      const wrongContract = await authorize({ to: alice.address, badgeTypeId: id, deadline: d, contract: other.address });
      await expect(badges.mint(alice.address, id, d, wrongContract))
        .to.be.revertedWithCustomError(badges, "InvalidSignature");
    });

    it("rejects minting to the zero address", async () => {
      const id = typeId("x"); const d = await future();
      const sig = await authorize({ to: ethers.ZeroAddress, badgeTypeId: id, deadline: d });
      await expect(badges.mint(ethers.ZeroAddress, id, d, sig))
        .to.be.revertedWithCustomError(badges, "ZeroAddress");
    });

    it("cannot mint while paused, resumes after unpause", async () => {
      const id = typeId("x"); const d = await future();
      const sig = await authorize({ to: alice.address, badgeTypeId: id, deadline: d });
      await badges.connect(owner).pause();
      await expect(badges.mint(alice.address, id, d, sig))
        .to.be.revertedWithCustomError(badges, "EnforcedPause");
      await badges.connect(owner).unpause();
      await expect(badges.mint(alice.address, id, d, sig)).to.emit(badges, "BadgeMinted");
    });
  });

  // ─── Soulbound ───────────────────────────────────────────────────────────
  describe("soulbound", () => {
    beforeEach(async () => {
      const id = typeId("first-hunt"); const d = await future();
      await badges.mint(alice.address, id, d, await authorize({ to: alice.address, badgeTypeId: id, deadline: d }));
    });

    it("blocks transferFrom between wallets", async () => {
      await expect(badges.connect(alice).transferFrom(alice.address, bob.address, 1))
        .to.be.revertedWithCustomError(badges, "Soulbound");
    });
    it("blocks safeTransferFrom", async () => {
      await expect(
        badges.connect(alice)["safeTransferFrom(address,address,uint256)"](alice.address, bob.address, 1),
      ).to.be.revertedWithCustomError(badges, "Soulbound");
    });
    it("blocks approve-then-transfer by a third party", async () => {
      await badges.connect(alice).approve(bob.address, 1);
      await expect(badges.connect(bob).transferFrom(alice.address, bob.address, 1))
        .to.be.revertedWithCustomError(badges, "Soulbound");
    });
    it("reports locked() = true and advertises ERC-5192", async () => {
      expect(await badges.locked(1)).to.equal(true);
      expect(await badges.supportsInterface("0xb45a3c0e")).to.equal(true);
      expect(await badges.supportsInterface("0x80ac58cd")).to.equal(true); // ERC-721
    });
    it("locked() reverts for a non-existent token", async () => {
      await expect(badges.locked(999)).to.be.reverted;
    });
  });

  // ─── Burn ────────────────────────────────────────────────────────────────
  describe("burn", () => {
    beforeEach(async () => {
      const id = typeId("first-hunt"); const d = await future();
      await badges.mint(alice.address, id, d, await authorize({ to: alice.address, badgeTypeId: id, deadline: d }));
    });
    it("lets the holder burn their own badge", async () => {
      await badges.connect(alice).burn(1);
      await expect(badges.ownerOf(1)).to.be.reverted;
      expect(await badges.balanceOf(alice.address)).to.equal(0);
    });
    it("stops anyone else from burning it", async () => {
      await expect(badges.connect(bob).burn(1)).to.be.revertedWithCustomError(badges, "NotYourBadge");
    });
    it("does NOT allow re-minting a burned type (renouncing is permanent)", async () => {
      await badges.connect(alice).burn(1);
      const id = typeId("first-hunt"); const d = await future();
      const sig = await authorize({ to: alice.address, badgeTypeId: id, deadline: d });
      await expect(badges.mint(alice.address, id, d, sig))
        .to.be.revertedWithCustomError(badges, "AlreadyHasBadge");
    });
  });

  // ─── Metadata ────────────────────────────────────────────────────────────
  describe("metadata", () => {
    it("tokenURI = baseURI + typeId (per-type metadata)", async () => {
      const id = typeId("whale"); const d = await future();
      await badges.mint(alice.address, id, d, await authorize({ to: alice.address, badgeTypeId: id, deadline: d }));
      expect(await badges.tokenURI(1)).to.equal("https://gooddrops.xyz/api/badges/meta/" + id.toString());
    });
    it("owner can repoint baseURI (e.g. to IPFS) without an upgrade", async () => {
      const id = typeId("whale"); const d = await future();
      await badges.mint(alice.address, id, d, await authorize({ to: alice.address, badgeTypeId: id, deadline: d }));
      await expect(badges.connect(owner).setBaseURI("ipfs://cid/")).to.emit(badges, "BaseURIUpdated");
      expect(await badges.tokenURI(1)).to.equal("ipfs://cid/" + id.toString());
    });
    it("tokenURI reverts for non-existent token", async () => {
      await expect(badges.tokenURI(1)).to.be.reverted;
    });
  });

  // ─── Admin ───────────────────────────────────────────────────────────────
  describe("admin", () => {
    it("owner can rotate the badge signer, and new sigs validate against it", async () => {
      await expect(badges.connect(owner).setBadgeSigner(other.address))
        .to.emit(badges, "BadgeSignerUpdated").withArgs(signer.address, other.address);
      const id = typeId("x"); const d = await future();
      const bySigner = await authorize({ to: alice.address, badgeTypeId: id, deadline: d, who: signer });
      await expect(badges.mint(alice.address, id, d, bySigner))
        .to.be.revertedWithCustomError(badges, "InvalidSignature");
      const byNew = await authorize({ to: alice.address, badgeTypeId: id, deadline: d, who: other });
      await expect(badges.mint(alice.address, id, d, byNew)).to.emit(badges, "BadgeMinted");
    });
    it("non-owner cannot rotate signer / set URI / pause / upgrade", async () => {
      await expect(badges.connect(alice).setBadgeSigner(alice.address)).to.be.revertedWithCustomError(badges, "OwnableUnauthorizedAccount");
      await expect(badges.connect(alice).setBaseURI("x")).to.be.revertedWithCustomError(badges, "OwnableUnauthorizedAccount");
      await expect(badges.connect(alice).pause()).to.be.revertedWithCustomError(badges, "OwnableUnauthorizedAccount");
    });
    it("rejects zero badge signer", async () => {
      await expect(badges.connect(owner).setBadgeSigner(ethers.ZeroAddress)).to.be.revertedWithCustomError(badges, "ZeroAddress");
    });
  });

  // ─── UUPS upgrade ────────────────────────────────────────────────────────
  describe("upgradeability", () => {
    it("preserves state across a UUPS upgrade and keeps working", async () => {
      const id = typeId("first-hunt"); const d = await future();
      await badges.mint(alice.address, id, d, await authorize({ to: alice.address, badgeTypeId: id, deadline: d }));

      const V2 = await ethers.getContractFactory("GoodDropsBadges"); // same impl is enough to exercise the path
      const upgraded = await upgrades.upgradeProxy(await badges.getAddress(), V2, { unsafeAllow: ["constructor"] });

      expect(await upgraded.ownerOf(1)).to.equal(alice.address);
      expect(await upgraded.hasBadge(alice.address, id)).to.equal(true);
      expect(await upgraded.tokenCount()).to.equal(1);

      // still mintable post-upgrade
      const id2 = typeId("whale"); const d2 = await future();
      await upgraded.mint(bob.address, id2, d2, await authorize({ to: bob.address, badgeTypeId: id2, deadline: d2 }));
      expect(await upgraded.ownerOf(2)).to.equal(bob.address);
    });
    it("blocks a non-owner from upgrading", async () => {
      const V2 = await ethers.getContractFactory("GoodDropsBadges", alice);
      await expect(
        upgrades.upgradeProxy(await badges.getAddress(), V2, { unsafeAllow: ["constructor"] }),
      ).to.be.reverted;
    });
  });
});
