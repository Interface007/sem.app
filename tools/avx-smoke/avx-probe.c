/*
 * Negative control for the AVX smoke test: executes exactly one AVX
 * instruction. Under QEMU with a CPU model without AVX this must die with
 * SIGILL; if it does not, the smoke test proves nothing.
 */
int main(void) {
  __asm__ volatile("vxorps %%ymm0, %%ymm0, %%ymm0" ::: "xmm0");
  return 0;
}
