// Dump the disassembly of the functions at KH_ADDRS (comma-separated hex) to KH_OUT/asm/<addr>_<name>.asm.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import java.io.*;

public class KhAsm extends GhidraScript {
  @Override
  public void run() throws Exception {
    String outDir = System.getenv("KH_OUT"); if (outDir == null) outDir = "E:/ghidra_out/asm";
    File dd = new File(outDir, "asm"); dd.mkdirs();
    Program p = currentProgram;
    FunctionManager fm = p.getFunctionManager();
    Listing listing = p.getListing();
    for (String a : System.getenv("KH_ADDRS").split(",")) {
      Address ad = p.getAddressFactory().getDefaultAddressSpace().getAddress(Long.parseUnsignedLong(a.trim(), 16));
      Function f = fm.getFunctionContaining(ad);
      if (f == null) { println("no function at " + a); continue; }
      try (PrintWriter w = new PrintWriter(new File(dd, f.getEntryPoint() + "_" + f.getName() + ".asm"))) {
        for (Instruction ins : listing.getInstructions(f.getBody(), true)) {
          w.println(ins.getAddress() + "\t" + ins.toString());
        }
      }
    }
    println("KhAsm done");
  }
}
