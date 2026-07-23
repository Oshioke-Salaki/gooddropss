const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

// Focused coverage for the new createManyDrops() batch function: one signature,
// one transfer, N drops — plus the all-or-nothing revert paths.
describe("GoodDrops.createManyDrops", function () {
  const ONE = 10n ** 18n;
  let good, gToken, owner, dropper;

  async function now() {
    return (await ethers.provider.getBlock("latest")).timestamp;
  }
  function coords(n, badIndex = -1) {
    const lats = [];
    const lngs = [];
    for (let i = 0; i < n; i++) {
      lats.push(i === badIndex ? 999_000_000 : 6_500_000 + i * 100); // 999e6 > LAT_MAX
      lngs.push(3_300_000 + i * 100);
    }
    return [lats, lngs];
  }

  beforeEach(async () => {
    [owner, dropper] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockERC20");
    gToken = await Mock.deploy();
    await gToken.waitForDeployment();

    const GoodDrops = await ethers.getContractFactory("GoodDrops");
    // identityContract = zero → identity checks off (only claim() needs them).
    good = await upgrades.deployProxy(
      GoodDrops,
      [await gToken.getAddress(), ethers.ZeroAddress, owner.address],
      // OZ 5.x ReentrancyGuard is stateless but has a constructor the plugin
      // false-flags; the live contract was deployed the same way.
      { initializer: "initialize", kind: "uups", unsafeAllow: ["constructor"] },
    );
    await good.waitForDeployment();

    await gToken.mint(dropper.address, 10_000n * ONE);
    await gToken.connect(dropper).approve(await good.getAddress(), ethers.MaxUint256);
  });

  it("creates N drops in one tx, pulling the total in a single transfer", async () => {
    const n = 10;
    const amt = 100n * ONE;
    const expiry = (await now()) + 24 * 3600;
    const [lats, lngs] = coords(n);

    const before = await gToken.balanceOf(dropper.address);
    const tx = await good.connect(dropper).createManyDrops(lats, lngs, amt, expiry, "Near Colab");
    const rcpt = await tx.wait();

    expect(await good.dropCount()).to.equal(n);
    expect(await good.totalLocked()).to.equal(BigInt(n) * amt);
    expect(before - (await gToken.balanceOf(dropper.address))).to.equal(BigInt(n) * amt);
    expect(await gToken.balanceOf(await good.getAddress())).to.equal(BigInt(n) * amt);

    const created = rcpt.logs.filter((l) => {
      try { return good.interface.parseLog(l).name === "DropCreated"; } catch { return false; }
    });
    expect(created.length).to.equal(n);

    // ids run 1..n; each stores the shared params + its own coordinate.
    const d1 = await good.getDrop(1);
    expect(d1.dropper).to.equal(dropper.address);
    expect(d1.amount).to.equal(amt);
    expect(d1.hint).to.equal("Near Colab");
    expect(d1.lat).to.equal(6_500_000);
    const dn = await good.getDrop(n);
    expect(dn.lat).to.equal(6_500_000 + (n - 1) * 100);
  });

  it("continues drop ids after existing drops (no collision)", async () => {
    const expiry = (await now()) + 24 * 3600;
    await good.connect(dropper).createDrop(6_500_000, 3_300_000, 100n * ONE, expiry, "one");
    const [lats, lngs] = coords(3);
    const res = await good.connect(dropper).createManyDrops.staticCall(lats, lngs, 100n * ONE, expiry, "batch");
    expect(res.firstId).to.equal(2n);
    expect(res.count).to.equal(3n);
  });

  it("reverts on an empty or too-large batch (all-or-nothing)", async () => {
    const expiry = (await now()) + 3600;
    await expect(good.connect(dropper).createManyDrops([], [], 100n * ONE, expiry, "x"))
      .to.be.revertedWithCustomError(good, "InvalidBatch");
    const [lats, lngs] = coords(21);
    await expect(good.connect(dropper).createManyDrops(lats, lngs, 100n * ONE, expiry, "x"))
      .to.be.revertedWithCustomError(good, "InvalidBatch");
    expect(await good.dropCount()).to.equal(0);
  });

  it("reverts on length mismatch", async () => {
    const expiry = (await now()) + 3600;
    await expect(good.connect(dropper).createManyDrops([1, 2], [1], 100n * ONE, expiry, "x"))
      .to.be.revertedWithCustomError(good, "LengthMismatch");
  });

  it("reverts on amount out of range", async () => {
    const expiry = (await now()) + 3600;
    const [lats, lngs] = coords(3);
    await expect(good.connect(dropper).createManyDrops(lats, lngs, 0, expiry, "x"))
      .to.be.revertedWithCustomError(good, "InvalidAmount");
    await expect(good.connect(dropper).createManyDrops(lats, lngs, 501n * ONE, expiry, "x"))
      .to.be.revertedWithCustomError(good, "InvalidAmount");
  });

  it("reverts on an out-of-window expiry", async () => {
    const [lats, lngs] = coords(3);
    await expect(good.connect(dropper).createManyDrops(lats, lngs, 100n * ONE, (await now()) + 60, "x"))
      .to.be.revertedWithCustomError(good, "InvalidExpiry");
  });

  it("reverts if ANY coordinate is invalid — nothing is created", async () => {
    const expiry = (await now()) + 24 * 3600;
    const [lats, lngs] = coords(3, 1); // 2nd coordinate out of range
    await expect(good.connect(dropper).createManyDrops(lats, lngs, 100n * ONE, expiry, "x"))
      .to.be.revertedWithCustomError(good, "InvalidCoordinates");
    expect(await good.dropCount()).to.equal(0);
    expect(await good.totalLocked()).to.equal(0);
  });

  it("respects pause()", async () => {
    await good.connect(owner).pause();
    const expiry = (await now()) + 3600;
    const [lats, lngs] = coords(2);
    await expect(good.connect(dropper).createManyDrops(lats, lngs, 100n * ONE, expiry, "x"))
      .to.be.reverted;
  });
});
